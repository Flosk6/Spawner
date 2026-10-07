import { BadRequestException, Injectable } from "@nestjs/common";
import { capacity, CAPACITY_RESERVES, median } from "@spawner/core";
import { PrismaService } from "../../common/prisma.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { TimelineService } from "../timeline/timeline.service";
import type { EnvironmentDisk } from "./disk";
import { DiskService } from "./disk.service";
import { MetricsCollector } from "./metrics-collector.service";

/** How far back a chart goes. */
export const RANGES = { "1h": 3600, "6h": 6 * 3600, "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400 } as const;
export type Range = keyof typeof RANGES;

/** Points of a chart, at most. */
const MAX_POINTS = 360;
/** Beyond this, charts read the 15-minute rollups. */
const POINTS_KEPT_SECONDS = 48 * 3600;
const GiB = 1024 ** 3;
/** Disk of an environment of a project that never ran one. */
const DEFAULT_ENV_DISK_BYTES = 2 * GiB;

export interface MetricView {
  time: Date;
  cpuPercent: number;
  memoryBytes: number;
  /** Highest memory of the period, for rollups. */
  memoryMaxBytes?: number;
  memoryLimitBytes?: number | null;
  services?: Record<string, { cpu: number; memory: number }>;
}

export interface Alert {
  level: "warning" | "critical";
  kind: "disk" | "memory" | "crash_loop" | "oom";
  message: string;
  environmentId?: string;
}

export function parseRange(value: string | undefined, fallback: Range): Range {
  const range = (value ?? fallback) as Range;
  if (!(range in RANGES)) {
    throw new BadRequestException(`range must be one of ${Object.keys(RANGES).join(", ")}`);
  }
  return range;
}

/**
 * Averages consecutive points down to at most max points, so that a week of
 * minutes stays a readable chart.
 */
export function downsample(points: MetricView[], max = MAX_POINTS): MetricView[] {
  if (points.length <= max) {
    return points;
  }
  const size = Math.ceil(points.length / max);
  const result: MetricView[] = [];
  for (let start = 0; start < points.length; start += size) {
    const chunk = points.slice(start, start + size);
    const services: Record<string, { cpu: number; memory: number }> = {};
    for (const point of chunk) {
      for (const [name, value] of Object.entries(point.services ?? {})) {
        services[name] ??= { cpu: 0, memory: 0 };
        services[name].cpu += value.cpu / chunk.length;
        services[name].memory += value.memory / chunk.length;
      }
    }
    result.push({
      time: chunk[0].time,
      cpuPercent: Math.round((chunk.reduce((sum, point) => sum + point.cpuPercent, 0) / chunk.length) * 10) / 10,
      memoryBytes: Math.round(chunk.reduce((sum, point) => sum + point.memoryBytes, 0) / chunk.length),
      memoryMaxBytes: Math.max(...chunk.map((point) => point.memoryMaxBytes ?? point.memoryBytes)),
      memoryLimitBytes: chunk[chunk.length - 1].memoryLimitBytes,
      ...(Object.keys(services).length
        ? { services: Object.fromEntries(Object.entries(services).map(([name, value]) => [name, { cpu: Math.round(value.cpu * 10) / 10, memory: Math.round(value.memory) }])) }
        : {}),
    });
  }
  return result;
}

/**
 * Reads what the supervision collected: charts, the state of the host and
 * its alerts, the cost of the projects and the room left for more
 * environments.
 */
@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SpawnerConfig,
    private readonly collector: MetricsCollector,
    private readonly disk: DiskService,
    private readonly timeline: TimelineService,
  ) {}

  /**
   * CPU and memory of an environment over a range, with each service up to
   * 48 hours, and the peak memory of each service.
   */
  async environmentMetrics(environmentId: string, range: Range) {
    const since = new Date(Date.now() - RANGES[range] * 1000);
    let points: MetricView[];
    if (RANGES[range] <= POINTS_KEPT_SECONDS) {
      const rows = await this.prisma.metricPoint.findMany({ where: { scope: "env", environmentId, time: { gte: since } }, orderBy: { time: "asc" } });
      points = rows.map((row) => ({
        time: row.time,
        cpuPercent: row.cpuPercent,
        memoryBytes: Number(row.memoryBytes),
        memoryLimitBytes: row.memoryLimitBytes === null ? null : Number(row.memoryLimitBytes),
        services: (row.details ?? {}) as Record<string, { cpu: number; memory: number }>,
      }));
    } else {
      const rows = await this.prisma.metricRollup.findMany({ where: { scope: "env", environmentId, time: { gte: since } }, orderBy: { time: "asc" } });
      points = rows.map((row) => ({ time: row.time, cpuPercent: row.cpuAvg, memoryBytes: Number(row.memoryAvg), memoryMaxBytes: Number(row.memoryMax) }));
    }
    const peaks: Record<string, number> = {};
    for (const point of points) {
      for (const [name, value] of Object.entries(point.services ?? {})) {
        peaks[name] = Math.max(peaks[name] ?? 0, value.memory);
      }
    }
    return { range, points: downsample(points), peaks, now: this.collector.environment(environmentId) };
  }

  /**
   * The host now: CPU, memory (environments, Spawner, other containers,
   * cache, swap), disk, alerts, and each project's share.
   */
  async system() {
    const now = this.collector.host();
    const snapshot = await this.disk.latest();
    const environments = await this.prisma.environment.findMany({
      where: { deletedAt: null },
      select: { id: true, slug: true, status: true, project: { select: { slug: true, name: true } } },
    });
    const projects = new Map<string, { slug: string; name: string; environments: number; running: number; cpuPercent: number; memoryBytes: number; diskBytes: number }>();
    for (const environment of environments) {
      const project = projects.get(environment.project.slug) ?? { ...environment.project, environments: 0, running: 0, cpuPercent: 0, memoryBytes: 0, diskBytes: 0 };
      const usage = this.collector.environment(environment.id);
      project.environments++;
      project.running += usage ? 1 : 0;
      project.cpuPercent = Math.round((project.cpuPercent + (usage?.cpuPercent ?? 0)) * 10) / 10;
      project.memoryBytes += usage?.memoryBytes ?? 0;
      project.diskBytes += snapshot?.details.environments[environment.id]?.totalBytes ?? 0;
      projects.set(environment.project.slug, project);
    }
    return {
      at: now?.at ?? null,
      host: now?.host ?? null,
      usage: now ? { environments: now.environments, spawner: now.spawner, others: now.others } : null,
      disk: snapshot,
      alerts: await this.alerts(environments),
      projects: [...projects.values()].sort((a, b) => b.memoryBytes - a.memoryBytes),
    };
  }

  /**
   * The host over a range: its CPU and used memory, and the memory of the
   * environments, of Spawner and of the other containers.
   */
  async systemMetrics(range: Range) {
    const since = new Date(Date.now() - RANGES[range] * 1000);
    const rows =
      RANGES[range] <= POINTS_KEPT_SECONDS
        ? await this.prisma.$queryRaw<{ time: Date; scope: string; cpu: number; memory: bigint; limit: bigint | null }[]>`
            SELECT time, scope, sum(cpu_percent)::float8 AS cpu, sum(memory_bytes)::bigint AS memory, max(memory_limit_bytes) AS limit
            FROM metric_points WHERE time >= ${since} GROUP BY time, scope ORDER BY time`
        : await this.prisma.$queryRaw<{ time: Date; scope: string; cpu: number; memory: bigint; limit: bigint | null }[]>`
            SELECT time, scope, sum(cpu_avg)::float8 AS cpu, sum(memory_avg)::bigint AS memory, NULL::bigint AS limit
            FROM metric_rollups WHERE time >= ${since} GROUP BY time, scope ORDER BY time`;
    const byTime = new Map<number, { time: Date; cpuPercent: number; memoryBytes: number; memoryTotalBytes: number | null; environments: number; spawner: number; others: number }>();
    for (const row of rows) {
      const point = byTime.get(row.time.getTime()) ?? { time: row.time, cpuPercent: 0, memoryBytes: 0, memoryTotalBytes: null, environments: 0, spawner: 0, others: 0 };
      if (row.scope === "host") {
        point.cpuPercent = row.cpu;
        point.memoryBytes = Number(row.memory);
        point.memoryTotalBytes = row.limit === null ? null : Number(row.limit);
      } else if (row.scope === "env") {
        point.environments = Number(row.memory);
      } else if (row.scope === "spawner" || row.scope === "others") {
        point[row.scope] = Number(row.memory);
      }
      byTime.set(row.time.getTime(), point);
    }
    const points = [...byTime.values()];
    const size = Math.max(1, Math.ceil(points.length / MAX_POINTS));
    const sampled = points.filter((_, index) => index % size === 0);
    return { range, points: sampled };
  }

  /**
   * How many more environments of each project fit, from the memory the
   * host can hand out and its free disk, divided by what an environment of
   * the project typically uses.
   */
  async capacity() {
    const host = this.collector.host()?.host ?? null;
    const projects = await this.prisma.project.findMany({ orderBy: { slug: "asc" } });
    const snapshot = await this.disk.latest();
    const typical = await this.typicalUsage(projects.map((project) => project.id), snapshot?.details.environments ?? {});
    return {
      host: host ? { availableMemoryBytes: host.memory.availableBytes, freeDiskBytes: host.disk.freeBytes, reserves: CAPACITY_RESERVES } : null,
      projects: projects.map((project) => {
        const cost = typical.get(project.id)!;
        const places = host
          ? capacity({ availableMemoryBytes: host.memory.availableBytes, freeDiskBytes: host.disk.freeBytes, envMemoryBytes: cost.memoryBytes, envDiskBytes: cost.diskBytes })
          : null;
        return { project: project.slug, name: project.name, ...cost, ...(places ?? { places: null }) };
      }),
    };
  }

  /**
   * What a project uses now, and what an environment of it typically costs.
   */
  async projectUsage(projectId: string) {
    const [environments, snapshot] = await Promise.all([
      this.prisma.environment.findMany({ where: { projectId, deletedAt: null }, select: { id: true, status: true } }),
      this.disk.latest(),
    ]);
    const typical = (await this.typicalUsage([projectId], snapshot?.details.environments ?? {})).get(projectId)!;
    const builds = await this.prisma.job.findMany({
      where: { environment: { projectId }, type: { in: ["create", "update"] }, status: "succeeded", finishedAt: { gte: new Date(Date.now() - 30 * 86400_000) } },
      select: { startedAt: true, finishedAt: true },
    });
    const durations = builds.filter((job) => job.startedAt && job.finishedAt).map((job) => (job.finishedAt!.getTime() - job.startedAt!.getTime()) / 1000);
    const counts: Record<string, number> = {};
    environments.forEach((environment) => (counts[environment.status] = (counts[environment.status] ?? 0) + 1));
    const usage = environments.map((environment) => this.collector.environment(environment.id));
    return {
      environments: { total: environments.length, byStatus: counts },
      now: {
        cpuPercent: Math.round(usage.reduce((sum, value) => sum + (value?.cpuPercent ?? 0), 0) * 10) / 10,
        memoryBytes: usage.reduce((sum, value) => sum + (value?.memoryBytes ?? 0), 0),
        diskBytes: environments.reduce((sum, environment) => sum + (snapshot?.details.environments[environment.id]?.totalBytes ?? 0), 0),
      },
      typical: { ...typical, buildSeconds: median(durations) },
    };
  }

  /**
   * Typical memory and disk of an environment of each project: the median
   * over its environments of the last day (memory) and of the last measure
   * (disk), or its declared limits without history.
   */
  private async typicalUsage(projectIds: string[], disks: Record<string, EnvironmentDisk>) {
    const averages = projectIds.length
      ? await this.prisma.$queryRaw<{ project_id: string; environment_id: string; memory: number }[]>`
          SELECT project_id, environment_id, avg(memory_bytes)::float8 AS memory FROM metric_points
          WHERE scope = 'env' AND time >= ${new Date(Date.now() - 86400_000)} AND project_id = ANY(${projectIds})
          GROUP BY project_id, environment_id`
      : [];
    const environments = await this.prisma.environment.findMany({ where: { projectId: { in: projectIds }, deletedAt: null }, select: { id: true, projectId: true, manifest: true } });
    const result = new Map<string, { memoryBytes: number; diskBytes: number; basedOn: { memory: "usage" | "limits"; disk: "usage" | "default" } }>();
    for (const projectId of projectIds) {
      const memory = median(averages.filter((row) => row.project_id === projectId).map((row) => row.memory));
      const own = environments.filter((environment) => environment.projectId === projectId);
      const disk = median(own.map((environment) => disks[environment.id]?.totalBytes).filter((value): value is number => typeof value === "number" && value > 0));
      const declared = median(own.map((environment) => (environment.manifest as { limits?: { memory?: number } } | null)?.limits?.memory ?? this.config.composeLimits.envMemoryBytes));
      result.set(projectId, {
        memoryBytes: Math.round(memory ?? declared ?? this.config.composeLimits.envMemoryBytes),
        diskBytes: Math.round(disk ?? DEFAULT_ENV_DISK_BYTES),
        basedOn: { memory: memory === null ? "limits" : "usage", disk: disk === null ? "default" : "usage" },
      });
    }
    return result;
  }

  /**
   * What an admin should look at: a disk filling up (more than 80% used
   * with less than 50 GiB free, or less than the 10 GiB reserve), memory
   * short for builds, a service failing in a loop, a service killed for
   * lack of memory in the last hour.
   */
  private async alerts(environments: { id: string; slug: string; project: { slug: string } }[]): Promise<Alert[]> {
    const alerts: Alert[] = [];
    const host = this.collector.host()?.host;
    if (host && host.disk.totalBytes > 0) {
      const free = host.disk.freeBytes;
      const used = 1 - free / host.disk.totalBytes;
      const critical = (used > 0.9 && free < 20 * GiB) || free < CAPACITY_RESERVES.diskBytes;
      if (critical || (used > 0.8 && free < 50 * GiB)) {
        alerts.push({
          level: critical ? "critical" : "warning",
          kind: "disk",
          message: `The disk of ${host.disk.path} is ${Math.round(used * 100)}% full (${formatGiB(host.disk.freeBytes)} free)`,
        });
      }
    }
    if (host && host.memory.availableBytes < this.config.minFreeMemoryBytes) {
      alerts.push({
        level: "warning",
        kind: "memory",
        message: `Only ${formatGiB(host.memory.availableBytes)} of memory available: builds wait until ${formatGiB(this.config.minFreeMemoryBytes)} are free`,
      });
    }
    const labels = new Map(environments.map((environment) => [environment.id, `${environment.project.slug}/${environment.slug}`]));
    const loops = await this.timeline.crashLoops([...labels.keys()]);
    for (const [environmentId, services] of loops) {
      for (const loop of services) {
        alerts.push({
          level: "critical",
          kind: "crash_loop",
          environmentId,
          message: `${loop.service} of ${labels.get(environmentId)} failed ${loop.count} times in ${loop.windowMinutes} minutes, last cause: ${loop.lastCause}`,
        });
      }
    }
    const ooms = await this.prisma.environmentEvent.groupBy({
      by: ["environmentId", "service"],
      where: { type: "oom", time: { gte: new Date(Date.now() - 3600_000) }, environmentId: { in: [...labels.keys()] } },
      _count: { _all: true },
    });
    for (const oom of ooms) {
      if (!loops.get(oom.environmentId)?.some((loop) => loop.service === oom.service)) {
        alerts.push({
          level: "warning",
          kind: "oom",
          environmentId: oom.environmentId,
          message: `${oom.service ?? "a service"} of ${labels.get(oom.environmentId)} ran out of memory ${oom._count._all === 1 ? "once" : `${oom._count._all} times`} in the last hour`,
        });
      }
    }
    return alerts;
  }
}

function formatGiB(bytes: number): string {
  return bytes >= GiB ? `${(bytes / GiB).toFixed(1)} GiB` : `${Math.round(bytes / 1024 ** 2)} MiB`;
}
