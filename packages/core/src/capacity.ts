const GiB = 1024 ** 3;

/**
 * What stays free whatever the environments need: room for the system,
 * Spawner and a build.
 */
export const CAPACITY_RESERVES = { memoryBytes: 1 * GiB, diskBytes: 10 * GiB };

export interface CapacityInput {
  /** Memory the kernel can hand out now (MemAvailable, page cache included). */
  availableMemoryBytes: number;
  freeDiskBytes: number;
  /** Typical memory of a running environment of the project: the median, or its declared limit without history. */
  envMemoryBytes: number;
  /** Typical disk an environment of the project adds: its own image layers, volumes, writable layers and sources. */
  envDiskBytes: number;
  /** Environments the quotas still allow, when quotas apply. */
  quotaRemaining?: number | null;
  reserves?: { memoryBytes: number; diskBytes: number };
  /**
   * Memory and disk a build waits for before it starts (null: not checked).
   * Every new environment is built, so the last one must still find them.
   */
  buildGuards?: { memoryBytes: number | null; diskBytes: number | null };
}

export interface Capacity {
  /** Environments of the project that can still start. */
  places: number;
  byMemory: number;
  byDisk: number;
  byQuota: number | null;
  limitedBy: 'memory' | 'disk' | 'quota';
}

/**
 * How many more environments of a project fit:
 *
 *   by memory = (available memory - 1 GiB) / typical memory of an environment
 *   by disk   = (free disk - 10 GiB) / typical disk of an environment
 *   places    = min(by memory, by disk, quota left)
 *
 * With build guards, each environment is also counted only if its build
 * still finds the guard free once the previous ones run: with 2 GiB asked
 * before a build, the last one starts building with at least 2 GiB
 * available, even though 1 GiB is enough to keep once it runs.
 */
export function capacity(input: CapacityInput): Capacity {
  const reserves = input.reserves ?? CAPACITY_RESERVES;
  const byMemory = fitBuilt(input.availableMemoryBytes, reserves.memoryBytes, input.buildGuards?.memoryBytes, input.envMemoryBytes);
  const byDisk = fitBuilt(input.freeDiskBytes, reserves.diskBytes, input.buildGuards?.diskBytes, input.envDiskBytes);
  const byQuota = input.quotaRemaining === undefined || input.quotaRemaining === null ? null : Math.max(0, input.quotaRemaining);
  const candidates: [Capacity['limitedBy'], number][] = [
    ['memory', byMemory],
    ['disk', byDisk],
    ...(byQuota === null ? [] : ([['quota', byQuota]] as [Capacity['limitedBy'], number][])),
  ];
  const [limitedBy, places] = candidates.reduce((lowest, candidate) => (candidate[1] < lowest[1] ? candidate : lowest));
  return { places, byMemory, byDisk, byQuota, limitedBy };
}

/**
 * Environments of `each` bytes that fit in `free` with `reserve` kept once
 * they all run, when each build must find `guard` free before it starts.
 */
function fitBuilt(free: number, reserve: number, guard: number | null | undefined, each: number): number {
  const size = Math.max(each, 1);
  const running = Math.max(0, Math.floor((free - reserve) / size));
  if (guard === null || guard === undefined) {
    return running;
  }
  return free < guard ? 0 : Math.min(running, Math.floor((free - guard) / size) + 1);
}

/**
 * The median of some values, or null without any.
 */
export function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
