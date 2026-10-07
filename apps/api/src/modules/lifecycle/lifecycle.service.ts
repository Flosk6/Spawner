import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { Manifest } from "@spawner/core";
import { PrismaService } from "../../common/prisma.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { AuditService } from "../audit/audit.service";
import { JobQueueService } from "../engine/job-queue.service";

/** Statuses an idle environment is put to sleep from. */
const AWAKE_STATUSES = ["ready", "degraded"];
/** An environment with one of these jobs waiting or running is left alone. */
const ACTIVE_JOB = { some: { status: { in: ["queued", "running"] } } };

/**
 * "2h", "45m", "1d", "1d 6h".
 */
export function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [days ? `${days}d` : "", hours ? `${hours}h` : "", minutes && !days ? `${minutes}m` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : `${seconds}s`;
}

/**
 * Idle time of an environment before it sleeps: its spawner.yaml's idle, or
 * the server's. 0 when it never sleeps.
 */
export function idleSecondsOf(manifest: Pick<Manifest, "idle"> | null, serverIdleSeconds: number): number {
  if (manifest?.idle === "never") {
    return 0;
  }
  return typeof manifest?.idle === "number" ? manifest.idle : serverIdleSeconds;
}

/**
 * The lifecycle of environments, every minute: those without activity for
 * their idle time go to sleep (their containers stop, their URLs wake them up
 * again), and expired ones are deleted with everything they own.
 */
@Injectable()
export class LifecycleService {
  private readonly logger = new Logger(LifecycleService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SpawnerConfig,
    private readonly queue: JobQueueService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(now = new Date()): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.sleepIdle(now);
      await this.expire(now);
    } catch (error) {
      this.logger.error(`Lifecycle tick failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Puts to sleep the awake environments whose last activity is older than
   * their idle time.
   *
   * @returns The environments put to sleep
   */
  async sleepIdle(now: Date): Promise<string[]> {
    const environments = await this.prisma.environment.findMany({
      where: { deletedAt: null, status: { in: AWAKE_STATUSES }, NOT: { jobs: ACTIVE_JOB } },
      select: { id: true, manifest: true, lastActivityAt: true, updatedAt: true },
    });
    const asleep: string[] = [];
    for (const environment of environments) {
      const idle = idleSecondsOf(environment.manifest as Pick<Manifest, "idle"> | null, this.config.envIdleSeconds);
      const since = environment.lastActivityAt ?? environment.updatedAt;
      if (idle === 0 || now.getTime() - since.getTime() < idle * 1000) {
        continue;
      }
      await this.queue.enqueue(environment.id, "sleep", null, null, `Spawner (no activity for ${formatDuration(idle)})`);
      asleep.push(environment.id);
    }
    return asleep;
  }

  /**
   * Deletes the environments past their expiry, whatever their status.
   *
   * @returns The environments whose deletion was queued
   */
  async expire(now: Date): Promise<string[]> {
    const environments = await this.prisma.environment.findMany({
      where: { deletedAt: null, expiresAt: { lt: now }, status: { notIn: ["deleting", "deleted"] }, NOT: { jobs: ACTIVE_JOB } },
      include: { project: { select: { slug: true } } },
    });
    for (const environment of environments) {
      await this.queue.enqueue(environment.id, "delete", null, null, "Spawner (expired)");
      await this.audit.record(null, "env.expire", { actorName: "Spawner", target: `${environment.project.slug}/${environment.slug}` });
    }
    return environments.map((environment) => environment.id);
  }
}
