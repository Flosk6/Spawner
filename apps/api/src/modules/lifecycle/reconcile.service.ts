import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type Docker from "dockerode";
import { DockerService } from "../../common/docker.service";
import { PrismaService } from "../../common/prisma.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { TRANSITIONAL_STATUSES } from "../engine/job-queue.service";
import { TimelineService } from "../timeline/timeline.service";
import { CleanupService } from "./cleanup.service";

/** Leaves the job queue time to recover interrupted jobs first. */
const FIRST_RUN_DELAY_MS = 15_000;

/**
 * What is wrong with the containers of an awake environment: "api exited
 * with code 1", "db is restarting", "web is unhealthy". Empty when every
 * service runs.
 */
export function containerProblems(containers: Pick<Docker.ContainerInfo, "Labels" | "State" | "Status">[]): string[] {
  return containers.flatMap((container) => {
    const service = container.Labels["dev.spawner.service"] ?? container.Labels["com.docker.compose.service"] ?? "a service";
    if (container.State === "running") {
      return /\(unhealthy\)/.test(container.Status) ? [`${service} is unhealthy`] : [];
    }
    if (container.State === "restarting") {
      return [`${service} is restarting`];
    }
    const exit = /Exited \((\d+)\)/.exec(container.Status)?.[1];
    return [exit ? `${service} exited with code ${exit}` : `${service} is ${container.State}`];
  });
}

/**
 * Keeps the database true to Docker, at startup and every minute. An awake
 * environment with a service down is "degraded" until it runs again; one
 * whose containers are gone failed; one left in a transitional status
 * without a job failed too. Then the automatic cleanup removes what deleted
 * environments left behind.
 */
@Injectable()
export class ReconcileService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReconcileService.name);
  private running = false;
  private first?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly docker: DockerService,
    private readonly config: SpawnerConfig,
    private readonly timeline: TimelineService,
    private readonly cleanup: CleanupService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV !== "test") {
      this.first = setTimeout(() => void this.run(), FIRST_RUN_DELAY_MS);
    }
  }

  onModuleDestroy(): void {
    if (this.first) {
      clearTimeout(this.first);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.states();
      await this.cleanup.run({ all: false });
    } catch (error) {
      this.logger.error(`Reconciliation failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Compares the environments without a job to their containers and fixes
   * their status.
   */
  async states(): Promise<void> {
    const environments = await this.prisma.environment.findMany({
      where: {
        deletedAt: null,
        status: { in: ["ready", "degraded", ...TRANSITIONAL_STATUSES] },
        NOT: { jobs: { some: { status: { in: ["queued", "running"] } } } },
      },
      select: { id: true, status: true, error: true, expiresAt: true },
    });
    if (environments.length === 0) {
      return;
    }
    const containers = await this.docker.client.listContainers({ all: true, filters: { label: ["dev.spawner.env"] } });
    const byEnvironment = new Map<string, Docker.ContainerInfo[]>();
    containers.forEach((container) => {
      const id = container.Labels["dev.spawner.env"];
      byEnvironment.set(id, [...(byEnvironment.get(id) ?? []), container]);
    });

    for (const environment of environments) {
      const own = byEnvironment.get(environment.id) ?? [];
      if (TRANSITIONAL_STATUSES.includes(environment.status)) {
        await this.fail(environment, `interrupted while ${environment.status}: no job runs for it any more`);
        continue;
      }
      if (own.length === 0) {
        await this.fail(environment, "its containers are gone (removed outside Spawner): redeploy it");
        await this.timeline.record(environment.id, "crash", "Its containers are gone (removed outside Spawner)");
        continue;
      }
      const problems = containerProblems(own);
      if (problems.length > 0) {
        const error = problems.join("; ");
        if (environment.status !== "degraded" || environment.error !== error) {
          await this.prisma.environment.update({ where: { id: environment.id }, data: { status: "degraded", error } });
        }
      } else if (environment.status === "degraded") {
        await this.prisma.environment.update({ where: { id: environment.id }, data: { status: "ready", error: null } });
      }
    }
  }

  private async fail(environment: { id: string; expiresAt: Date | null }, error: string): Promise<void> {
    await this.prisma.environment.update({
      where: { id: environment.id },
      data: { status: "failed", error, ...(environment.expiresAt ? {} : { expiresAt: new Date(Date.now() + this.config.envTtlSeconds * 1000) }) },
    });
  }
}
