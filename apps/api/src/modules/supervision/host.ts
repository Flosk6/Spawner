import * as fs from "fs";
import * as os from "os";

/** The host right now: CPU, memory and the disk of the data directory. */
export interface HostSnapshot {
  cpus: number;
  /** Null when the kernel does not name it (some ARM machines). */
  cpuModel: string | null;
  /** Use of all cores since the previous reading, 0 to 100. */
  cpuPercent: number | null;
  load: [number, number, number];
  memory: {
    totalBytes: number;
    /** What the kernel can hand out (MemAvailable): free memory plus reclaimable cache. */
    availableBytes: number;
    /** Page cache and buffers, mostly reclaimable. */
    cacheBytes: number;
    swapTotalBytes: number;
    swapUsedBytes: number;
  };
  disk: { path: string; totalBytes: number; freeBytes: number };
  uptimeSeconds: number;
}

/**
 * Reads /proc/meminfo: values in bytes, by field name.
 */
export function parseMeminfo(text: string): Record<string, number> {
  const fields: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const match = /^(\w+(?:\(\w+\))?):\s+(\d+)(?:\s+kB)?$/.exec(line.trim());
    if (match) {
      fields[match[1]] = Number(match[2]) * (line.includes("kB") ? 1024 : 1);
    }
  }
  return fields;
}

/** CPU time counters of the host: busy and total jiffies. */
export interface CpuTimes {
  busy: number;
  total: number;
}

/**
 * Reads the aggregate "cpu" line of /proc/stat. Idle time is idle plus
 * iowait.
 */
export function parseCpuTimes(text: string): CpuTimes | null {
  const line = text.split("\n").find((candidate) => candidate.startsWith("cpu "));
  if (!line) {
    return null;
  }
  const values = line.trim().split(/\s+/).slice(1).map(Number);
  const total = values.slice(0, 8).reduce((sum, value) => sum + value, 0);
  const idle = (values[3] ?? 0) + (values[4] ?? 0);
  return { busy: total - idle, total };
}

export function hostCpuPercent(previous: CpuTimes | null, current: CpuTimes | null): number | null {
  if (!previous || !current || current.total <= previous.total) {
    return null;
  }
  return Math.round(((current.busy - previous.busy) / (current.total - previous.total)) * 1000) / 10;
}

/**
 * Reads the host through /proc on Linux (in Spawner's container, /proc
 * shows the host's memory and CPU), and through Node's os module elsewhere
 * (development on macOS).
 */
export class HostReader {
  private previousCpu: CpuTimes | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly proc = "/proc",
  ) {}

  read(): HostSnapshot {
    const meminfo = this.readText("meminfo");
    const fields = meminfo ? parseMeminfo(meminfo) : null;
    const cpuTimes = this.readCpuTimes();
    const cpuPercent = hostCpuPercent(this.previousCpu, cpuTimes);
    this.previousCpu = cpuTimes;
    const cpus = os.cpus();

    const memory = fields
      ? {
          totalBytes: fields.MemTotal ?? os.totalmem(),
          availableBytes: fields.MemAvailable ?? fields.MemFree ?? os.freemem(),
          cacheBytes: (fields.Cached ?? 0) + (fields.Buffers ?? 0) + (fields.SReclaimable ?? 0),
          swapTotalBytes: fields.SwapTotal ?? 0,
          swapUsedBytes: Math.max(0, (fields.SwapTotal ?? 0) - (fields.SwapFree ?? 0)),
        }
      : { totalBytes: os.totalmem(), availableBytes: os.freemem(), cacheBytes: 0, swapTotalBytes: 0, swapUsedBytes: 0 };

    const load = os.loadavg() as [number, number, number];
    return {
      cpus: cpus.length,
      cpuModel: cpus[0]?.model && cpus[0].model !== "unknown" ? cpus[0].model : null,
      cpuPercent,
      load: [round2(load[0]), round2(load[1]), round2(load[2])],
      memory,
      disk: this.disk(),
      uptimeSeconds: Math.round(os.uptime()),
    };
  }

  private readCpuTimes(): CpuTimes | null {
    const stat = this.readText("stat");
    if (stat) {
      return parseCpuTimes(stat);
    }
    const times = os.cpus().map((cpu) => cpu.times);
    const total = times.reduce((sum, time) => sum + time.user + time.nice + time.sys + time.idle + time.irq, 0);
    const idle = times.reduce((sum, time) => sum + time.idle, 0);
    return { busy: total - idle, total };
  }

  private disk(): HostSnapshot["disk"] {
    try {
      const stats = fs.statfsSync(this.dataDir);
      return { path: this.dataDir, totalBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize };
    } catch {
      return { path: this.dataDir, totalBytes: 0, freeBytes: 0 };
    }
  }

  private readText(name: string): string | null {
    try {
      return fs.readFileSync(`${this.proc}/${name}`, "utf8");
    } catch {
      return null;
    }
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
