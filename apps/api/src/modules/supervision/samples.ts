/** The CPU counters of a container sample (Docker stats API). */
export interface CpuCounters {
  /** Nanoseconds of CPU the container used since it started. */
  total: number;
  /** Nanoseconds of CPU the whole host used, as Docker reads it. */
  system: number;
  cpus: number;
}

/** The part of a Docker stats answer the collector reads. */
export interface DockerStatsSample {
  cpu_stats?: { cpu_usage?: { total_usage?: number; percpu_usage?: number[] }; system_cpu_usage?: number; online_cpus?: number };
  memory_stats?: { usage?: number; limit?: number; stats?: Record<string, number | undefined> };
}

export function cpuCounters(sample: DockerStatsSample): CpuCounters | null {
  const cpu = sample.cpu_stats;
  if (!cpu?.cpu_usage?.total_usage || !cpu.system_cpu_usage) {
    return null;
  }
  return { total: cpu.cpu_usage.total_usage, system: cpu.system_cpu_usage, cpus: cpu.online_cpus || cpu.cpu_usage.percpu_usage?.length || 1 };
}

/**
 * CPU of a container between two samples, as `docker stats` computes it:
 * its share of the host's CPU time, times the number of CPUs (200% is two
 * full cores).
 *
 * @returns The percentage, or null without a previous sample
 */
export function cpuPercent(previous: CpuCounters | null | undefined, current: CpuCounters | null): number | null {
  if (!previous || !current) {
    return null;
  }
  const cpuDelta = current.total - previous.total;
  const systemDelta = current.system - previous.system;
  if (systemDelta <= 0 || cpuDelta < 0) {
    return 0;
  }
  return Math.round((cpuDelta / systemDelta) * current.cpus * 1000) / 10;
}

/**
 * Memory of a container without the page cache the kernel can reclaim
 * (inactive_file), as `docker stats` counts it.
 */
export function memoryBytes(sample: DockerStatsSample): number {
  const stats = sample.memory_stats?.stats ?? {};
  const reclaimable = stats.inactive_file ?? stats.total_inactive_file ?? 0;
  return Math.max(0, (sample.memory_stats?.usage ?? 0) - reclaimable);
}

/** What accumulates over a minute for one scope (an environment, the host...). */
export interface Accumulated {
  cpuSum: number;
  cpuCount: number;
  memorySum: number;
  memoryCount: number;
  memoryLimit: number;
  services: Map<string, { cpuSum: number; cpuCount: number; memorySum: number; memoryCount: number; memoryLimit: number }>;
}

/** The averages of a minute. */
export interface MinuteAverage {
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  services: Record<string, { cpu: number; memory: number }>;
}

/**
 * Collects the samples of a minute, scope by scope, and gives their
 * averages once the minute is over.
 */
export class MinuteBucket {
  private readonly scopes = new Map<string, Accumulated>();

  constructor(readonly minute: number) {}

  add(scope: string, sample: { cpuPercent: number | null; memoryBytes: number; memoryLimitBytes: number; service?: string }): void {
    const entry = this.scopes.get(scope) ?? { cpuSum: 0, cpuCount: 0, memorySum: 0, memoryCount: 0, memoryLimit: 0, services: new Map() };
    this.scopes.set(scope, entry);
    if (sample.service) {
      const service = entry.services.get(sample.service) ?? { cpuSum: 0, cpuCount: 0, memorySum: 0, memoryCount: 0, memoryLimit: 0 };
      entry.services.set(sample.service, service);
      service.memoryLimit = Math.max(service.memoryLimit, sample.memoryLimitBytes);
      if (sample.cpuPercent !== null) {
        service.cpuSum += sample.cpuPercent;
        service.cpuCount++;
      }
      service.memorySum += sample.memoryBytes;
      service.memoryCount++;
    }
    if (sample.cpuPercent !== null) {
      entry.cpuSum += sample.cpuPercent;
      entry.cpuCount++;
    }
    entry.memorySum += sample.memoryBytes;
    entry.memoryCount++;
    entry.memoryLimit = Math.max(entry.memoryLimit, sample.memoryLimitBytes);
  }

  /**
   * Averages of each scope. A scope made of services (an environment, or a
   * group of containers) sums its services' averages and limits, so that one
   * sample missed by a container does not halve its environment.
   */
  averages(): Map<string, MinuteAverage> {
    const result = new Map<string, MinuteAverage>();
    for (const [scope, entry] of this.scopes) {
      const services = Object.fromEntries(
        [...entry.services].map(([name, service]) => [
          name,
          { cpu: round(service.cpuCount ? service.cpuSum / service.cpuCount : 0), memory: Math.round(service.memorySum / service.memoryCount) },
        ]),
      );
      const fromServices = Object.values(services);
      result.set(scope, {
        cpuPercent: fromServices.length ? round(fromServices.reduce((sum, service) => sum + service.cpu, 0)) : round(entry.cpuCount ? entry.cpuSum / entry.cpuCount : 0),
        memoryBytes: fromServices.length ? fromServices.reduce((sum, service) => sum + service.memory, 0) : Math.round(entry.memorySum / entry.memoryCount),
        memoryLimitBytes: entry.services.size ? [...entry.services.values()].reduce((sum, service) => sum + service.memoryLimit, 0) : entry.memoryLimit,
        services,
      });
    }
    return result;
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
