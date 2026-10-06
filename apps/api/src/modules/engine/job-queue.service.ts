import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import type { Job, Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import { JobLogsService } from "./job-logs.service";
import { PipelineError, PipelineService } from "./pipeline.service";
import { SpawnerConfig } from "./spawner.config";

export type JobType = "create" | "update" | "delete" | "stop" | "start";

const HEAVY_JOBS: JobType[] = ["create", "update"];
const LIGHT_JOBS: JobType[] = ["delete", "stop", "start"];
const LIGHT_CONCURRENCY = 4;
const TRANSITIONAL_STATUSES = ["queued", "preparing", "validating", "building", "seeding", "routing", "deleting", "stopping", "starting"];

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
   */
  async enqueue(environmentId: string, type: JobType, payload: object | null, triggeredById: number | null): Promise<Job> {
    const job = await this.prisma.job.create({
      data: {
        environmentId,
        type,
        status: "queued",
        payload: (payload ?? undefined) as Prisma.InputJsonValue | undefined,
        triggeredById,
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
    this.logs.append(job.id, `Job ${job.type} started`);
    try {
      await this.pipeline.run(job);
      this.logs.append(job.id, `Job ${job.type} succeeded`);
      await this.prisma.job.update({ where: { id: job.id }, data: { status: "succeeded", finishedAt: new Date() } });
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      const phase = error instanceof PipelineError ? error.phase : null;
      this.logs.append(job.id, `Job ${job.type} failed${phase ? ` during ${phase}` : ""}: ${message}`);
      await this.prisma.job.update({
        where: { id: job.id },
        data: { status: "failed", phase, error: message.slice(0, 4000), finishedAt: new Date() },
      });
      this.logger.warn(`Job ${job.id} (${job.type}) failed: ${message.split("\n")[0]}`);
    } finally {
      this.logs.close(job.id);
    }
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
        data: { status: "failed", error: "interrupted by a restart of Spawner", finishedAt: new Date() },
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
