import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import type { Job, Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import { TimelineService } from "../timeline/timeline.service";
import { JobLogsService } from "./job-logs.service";
import { PipelineError, PipelineService } from "./pipeline.service";
import { SpawnerConfig } from "../../common/spawner.config";

export type JobType = "create" | "update" | "delete" | "stop" | "start";

const HEAVY_JOBS: JobType[] = ["create", "update"];
const LIGHT_JOBS: JobType[] = ["delete", "stop", "start"];
const LIGHT_CONCURRENCY = 4;
const TRANSITIONAL_STATUSES = ["queued", "preparing", "validating", "building", "seeding", "routing", "deleting", "stopping", "starting"];
/** Job logs kept for each environment, the newest. */
const KEPT_JOB_LOGS = 5;
const JOB_NAMES: Record<string, string> = { create: "Creation", update: "Update", delete: "Deletion", stop: "Stop", start: "Start" };

/**
 * Job queue stored in the jobs table. A job is claimed with
 * FOR UPDATE SKIP LOCKED; an environment never runs two jobs at once and
 * runs its jobs in order. Builds are limited (1 below 8 GiB of RAM, 2 above);
 * light jobs such as deletions run alongside them.
 */
@Injectable()
export class JobQueueService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobQueueService.name);
  private readonly running = { heavy: 0, light: 0 };
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SpawnerConfig,
    private readonly pipeline: PipelineService,
    private readonly logs: JobLogsService,
    private readonly timeline: TimelineService,
  ) {}

  async onApplicationBootstrap() {
    await this.recoverInterruptedJobs();
    this.timer = setInterval(() => void this.tick(), 2000);
    void this.tick();
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /**
   * Queues a job for an environment.
   *
   * @param actor - Who asked, as the timeline shows it ("Ada via claude-laptop")
   */
  async enqueue(environmentId: string, type: JobType, payload: object | null, triggeredById: number | null, actor: string | null = null): Promise<Job> {
    const job = await this.prisma.job.create({
      data: {
        environmentId,
        type,
        status: "queued",
        payload: (payload ?? undefined) as Prisma.InputJsonValue | undefined,
        triggeredById,
        actor: actor?.slice(0, 100) ?? null,
      },
    });
    setImmediate(() => void this.tick());
    return job;
  }

  private async tick(): Promise<void> {
    if (this.ticking || this.stopped) {
      return;
    }
    this.ticking = true;
    try {
      for (const group of ["heavy", "light"] as const) {
        const limit = group === "heavy" ? this.config.buildConcurrency : LIGHT_CONCURRENCY;
        while (this.running[group] < limit) {
          const job = await this.claim(group === "heavy" ? HEAVY_JOBS : LIGHT_JOBS);
          if (!job) {
            break;
          }
          this.running[group]++;
          void this.execute(job).finally(() => {
            this.running[group]--;
            setImmediate(() => void this.tick());
          });
        }
      }
    } catch (error) {
      this.logger.error(`Job queue tick failed: ${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Takes the oldest queued job of the given types whose environment has no
   * running job and no older queued job.
   */
  private async claim(types: JobType[]): Promise<Job | null> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE jobs SET status = 'running', started_at = now()
      WHERE id = (
        SELECT j.id FROM jobs j
        WHERE j.status = 'queued'
          AND j.type = ANY(${types})
          AND NOT EXISTS (
            SELECT 1 FROM jobs r WHERE r.environment_id = j.environment_id AND r.status = 'running'
          )
          AND NOT EXISTS (
            SELECT 1 FROM jobs e WHERE e.environment_id = j.environment_id AND e.status = 'queued' AND e.created_at < j.created_at
          )
        ORDER BY j.created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    if (rows.length === 0) {
      return null;
    }
    return this.prisma.job.findUnique({ where: { id: rows[0].id } });
  }

  private async execute(job: Job): Promise<void> {
    const name = JOB_NAMES[job.type] ?? job.type;
    const started = Date.now();
    this.logs.append(job.id, `Job ${job.type} started`);
    await this.timeline.record(job.environmentId, "job_started", `${name} started${job.actor ? ` by ${job.actor}` : ""}`, { details: { jobId: job.id, type: job.type } });
    try {
      await this.pipeline.run(job);
      this.logs.append(job.id, `Job ${job.type} succeeded`);
      await this.prisma.job.update({ where: { id: job.id }, data: { status: "succeeded", finishedAt: new Date() } });
      const seconds = Math.round((Date.now() - started) / 1000);
      await this.timeline.record(job.environmentId, "job_succeeded", `${name} succeeded in ${formatSeconds(seconds)}`, { details: { jobId: job.id, type: job.type, seconds } });
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      const phase = error instanceof PipelineError ? error.phase : null;
      const errorCode = error instanceof PipelineError ? error.code : null;
      this.logs.append(job.id, `Job ${job.type} failed${phase ? ` during ${phase}` : ""}: ${message}`);
      await this.prisma.job.update({
        where: { id: job.id },
        data: { status: "failed", phase, error: message.slice(0, 4000), errorCode, finishedAt: new Date() },
      });
      await this.timeline.record(job.environmentId, "job_failed", `${name} failed${phase ? ` during ${phase}` : ""}: ${message.split("\n")[0].slice(0, 300)}`, {
        details: { jobId: job.id, type: job.type, phase, errorCode },
      });
      this.logger.warn(`Job ${job.id} (${job.type}) failed: ${message.split("\n")[0]}`);
    } finally {
      this.logs.close(job.id);
      await this.pruneLogs(job.environmentId);
    }
  }

  /**
   * Keeps the logs of the last five jobs of an environment.
   */
  private async pruneLogs(environmentId: string): Promise<void> {
    const old = await this.prisma.job.findMany({ where: { environmentId }, orderBy: { createdAt: "desc" }, skip: KEPT_JOB_LOGS, select: { id: true } }).catch(() => []);
    old.forEach((job) => this.logs.remove(job.id));
  }

  /**
   * Jobs that were running when the process stopped cannot be resumed: they
   * are marked failed, and so are the environments they left half-done.
   */
  private async recoverInterruptedJobs(): Promise<void> {
    const interrupted = await this.prisma.job.findMany({ where: { status: "running" } });
    for (const job of interrupted) {
      await this.prisma.job.update({
        where: { id: job.id },
        data: { status: "failed", error: "interrupted by a restart of Spawner", errorCode: "interrupted", finishedAt: new Date() },
      });
      await this.timeline.record(job.environmentId, "job_failed", `${JOB_NAMES[job.type] ?? job.type} interrupted by a restart of Spawner`, {
        details: { jobId: job.id, type: job.type, errorCode: "interrupted" },
      });
      await this.prisma.environment.updateMany({
        where: { id: job.environmentId, status: { in: TRANSITIONAL_STATUSES } },
        data: { status: "failed", error: "interrupted by a restart of Spawner" },
      });
    }
    if (interrupted.length > 0) {
      this.logger.warn(`${interrupted.length} interrupted job(s) marked as failed`);
    }
  }
}

/** "45s", "1m 42s", "12m". */
export function formatSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return seconds % 60 === 0 || minutes >= 10 ? `${minutes}m` : `${minutes}m ${seconds % 60}s`;
}
