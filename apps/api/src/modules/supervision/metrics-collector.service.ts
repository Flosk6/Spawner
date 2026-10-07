import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type Docker from "dockerode";
import { DockerService } from "../../common/docker.service";
import { PrismaService } from "../../common/prisma.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { HostReader, type HostSnapshot } from "./host";
import { cpuCounters, cpuPercent, memoryBytes, MinuteBucket, type CpuCounters, type DockerStatsSample } from "./samples";

const SAMPLE_INTERVAL_MS = 30_000;
const PARALLEL_SAMPLES = 8;
const LABEL_ENV = "dev.spawner.env";
const LABEL_SERVICE = "com.docker.compose.service";
const LABEL_PROJECT = "com.docker.compose.project";

/** A container right now. */
export interface ContainerNow {
  name: string;
  image: string;
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
}

/** An environment right now: the sum of its services. */
export interface EnvironmentNow {
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  services: Record<string, { cpuPercent: number; memoryBytes: number; memoryLimitBytes: number }>;
  at: Date;
}

/** The host right now, and who uses it. */
export interface HostNow {
  host: HostSnapshot;
  environments: { count: number; cpuPercent: number; memoryBytes: number };
  spawner: { cpuPercent: number; memoryBytes: number; containers: ContainerNow[] };
  others: { cpuPercent: number; memoryBytes: number; containers: ContainerNow[] };
  at: Date;
}

/**
 * Samples every running container and the host every 30 seconds, in
 * parallel and with one-shot stats (one Docker call per container, the CPU
 * computed from the previous sample), keeps the latest values in memory for
 * the interface, and writes the average of each minute to metric_points:
 * the host, Spawner's own containers, the other containers of the host, and
 * each environment with its services.
 */
@Injectable()
export class MetricsCollector implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MetricsCollector.name);
  private readonly previous = new Map<string, CpuCounters>();
  private readonly environments = new Map<string, EnvironmentNow>();
  private readonly hostReader: HostReader;
  private hostNow: HostNow | null = null;
  private bucket: MinuteBucket | null = null;
  private ownProject: Promise<string | null> | null = null;
  private timer?: NodeJS.Timeout;
  private sampling = false;

  constructor(
    private readonly docker: DockerService,
    private readonly prisma: PrismaService,
    config: SpawnerConfig,
  ) {
    this.hostReader = new HostReader(config.dataDir);
  }

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === "test") {
      return;
    }
    this.timer = setInterval(() => void this.sample(), SAMPLE_INTERVAL_MS);
    setTimeout(() => void this.sample(), 2_000).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /** The usage of an environment at the last sample, or null when none of its containers runs. */
  environment(environmentId: string): EnvironmentNow | null {
    return this.environments.get(environmentId) ?? null;
  }

  /** The host and its users at the last sample. */
  host(): HostNow | null {
    return this.hostNow;
  }

  /**
   * Takes one sample of everything. Skipped while the previous one runs.
   */
  async sample(now = new Date()): Promise<void> {
    if (this.sampling) {
      return;
    }
    this.sampling = true;
    try {
      const minute = Math.floor(now.getTime() / 60_000);
      if (this.bucket && this.bucket.minute !== minute) {
        await this.flush(this.bucket);
        this.bucket = null;
      }
      this.bucket ??= new MinuteBucket(minute);
      await this.collect(this.bucket, now);
    } catch (error) {
      this.logger.warn(`Sampling failed: ${(error as Error).message}`);
    } finally {
      this.sampling = false;
    }
  }

  private async collect(bucket: MinuteBucket, now: Date): Promise<void> {
    const containers = await this.docker.client.listContainers();
    this.ownProject ??= this.docker.ownComposeProject();
    const own = await this.ownProject;
    const samples = await mapLimit(containers, PARALLEL_SAMPLES, async (container) => ({
      container,
      sample: (await this.docker.statsSample(container.Id)) as DockerStatsSample | null,
    }));

    const environments = new Map<string, EnvironmentNow>();
    const spawner: ContainerNow[] = [];
    const others: ContainerNow[] = [];
    const seen = new Set<string>();
    for (const { container, sample } of samples) {
      if (!sample) {
        continue;
      }
      seen.add(container.Id);
      const counters = cpuCounters(sample);
      const cpu = cpuPercent(this.previous.get(container.Id), counters);
      if (counters) {
        this.previous.set(container.Id, counters);
      }
      const usage: ContainerNow = {
        name: containerName(container),
        image: container.Image,
        cpuPercent: cpu ?? 0,
        memoryBytes: memoryBytes(sample),
        memoryLimitBytes: sample.memory_stats?.limit ?? 0,
      };
      const environmentId = container.Labels[LABEL_ENV];
      if (environmentId) {
        const service = container.Labels[LABEL_SERVICE] ?? usage.name;
        bucket.add(`env:${environmentId}`, { service, cpuPercent: cpu, memoryBytes: usage.memoryBytes, memoryLimitBytes: usage.memoryLimitBytes });
        const environment = environments.get(environmentId) ?? { cpuPercent: 0, memoryBytes: 0, memoryLimitBytes: 0, services: {}, at: new Date() };
        environment.services[service] = { cpuPercent: usage.cpuPercent, memoryBytes: usage.memoryBytes, memoryLimitBytes: usage.memoryLimitBytes };
        environment.cpuPercent = round(environment.cpuPercent + usage.cpuPercent);
        environment.memoryBytes += usage.memoryBytes;
        environment.memoryLimitBytes += usage.memoryLimitBytes;
        environments.set(environmentId, environment);
      } else {
        const group = own && container.Labels[LABEL_PROJECT] === own ? "spawner" : "others";
        bucket.add(group, { service: usage.name, cpuPercent: cpu, memoryBytes: usage.memoryBytes, memoryLimitBytes: usage.memoryLimitBytes });
        (group === "spawner" ? spawner : others).push(usage);
      }
    }
    for (const id of this.previous.keys()) {
      if (!seen.has(id)) {
        this.previous.delete(id);
      }
    }

    const host = this.hostReader.read();
    bucket.add("host", {
      cpuPercent: host.cpuPercent,
      memoryBytes: host.memory.totalBytes - host.memory.availableBytes,
      memoryLimitBytes: host.memory.totalBytes,
    });

    this.environments.clear();
    environments.forEach((environment, id) => this.environments.set(id, environment));
    const total = (items: ContainerNow[]) => ({
      cpuPercent: round(items.reduce((sum, item) => sum + item.cpuPercent, 0)),
      memoryBytes: items.reduce((sum, item) => sum + item.memoryBytes, 0),
      containers: items.sort((a, b) => b.memoryBytes - a.memoryBytes),
    });
    const envValues = [...environments.values()];
    this.hostNow = {
      host,
      environments: {
        count: envValues.length,
        cpuPercent: round(envValues.reduce((sum, environment) => sum + environment.cpuPercent, 0)),
        memoryBytes: envValues.reduce((sum, environment) => sum + environment.memoryBytes, 0),
      },
      spawner: total(spawner),
      others: total(others),
      at: now,
    };
  }

  /**
   * Writes the averages of a finished minute.
   */
  private async flush(bucket: MinuteBucket): Promise<void> {
    const time = new Date(bucket.minute * 60_000);
    const averages = bucket.averages();
    const environmentIds = [...averages.keys()].filter((scope) => scope.startsWith("env:")).map((scope) => scope.slice(4));
    const projects = new Map(
      (await this.prisma.environment.findMany({ where: { id: { in: environmentIds } }, select: { id: true, projectId: true } })).map((environment) => [
        environment.id,
        environment.projectId,
      ]),
    );
    const host = this.hostNow?.host;
    const rows: Prisma.MetricPointCreateManyInput[] = [];
    for (const [scope, average] of averages) {
      const environmentId = scope.startsWith("env:") ? scope.slice(4) : null;
      if (environmentId && !projects.has(environmentId)) {
        continue;
      }
      rows.push({
        time,
        scope: environmentId ? "env" : scope,
        environmentId,
        projectId: environmentId ? projects.get(environmentId) : null,
        cpuPercent: average.cpuPercent,
        memoryBytes: BigInt(average.memoryBytes),
        memoryLimitBytes: average.memoryLimitBytes ? BigInt(average.memoryLimitBytes) : null,
        details: (scope === "host" && host
          ? {
              availableBytes: host.memory.availableBytes,
              cacheBytes: host.memory.cacheBytes,
              swapUsedBytes: host.memory.swapUsedBytes,
              load: host.load[0],
              diskFreeBytes: host.disk.freeBytes,
            }
          : average.services) as Prisma.InputJsonValue,
      });
    }
    if (rows.length > 0) {
      await this.prisma.metricPoint.createMany({ data: rows });
    }
  }
}

function containerName(container: Docker.ContainerInfo): string {
  return (container.Names?.[0] ?? container.Id.slice(0, 12)).replace(/^\//, "");
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Runs fn on every item, at most limit at a time.
 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
