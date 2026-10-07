import { Injectable } from "@nestjs/common";
import * as fs from "fs";
import * as os from "os";
import { parseMeminfo } from "../supervision/host";

const bytesToGB = (bytes: number) => bytes / 1024 ** 3;

export interface SystemMemoryStats {
  total: number;
  used: number;
  free: number;
  usagePercent: number;
}

export interface MemoryCheckResult {
  available: boolean;
  message: string;
  details: {
    memoryTotal: number;
    memoryUsed: number;
    memoryFree: number;
    minRequired: number;
    memoryTotalGB: string;
    memoryUsedGB: string;
    memoryAvailableGB: string;
    minRequiredGB: string;
  };
}

/**
 * The memory guard of builds: a build waits until enough memory is
 * available. Available means what the kernel can hand out (MemAvailable on
 * Linux, page cache included), not only the free pages.
 */
@Injectable()
export class SystemStatsService {
  /** Where the kernel reports memory; os.freemem() when unreadable (macOS). */
  meminfoPath = "/proc/meminfo";

  getMemoryStats(): SystemMemoryStats {
    let total = os.totalmem();
    let free = os.freemem();
    try {
      const fields = parseMeminfo(fs.readFileSync(this.meminfoPath, "utf8"));
      total = fields.MemTotal ?? total;
      free = fields.MemAvailable ?? free;
    } catch {
      // Not Linux: the os module's numbers.
    }
    const used = total - free;

    return {
      total,
      used,
      free,
      usagePercent: Math.round((used / total) * 100 * 10) / 10,
    };
  }

  checkMemoryAvailability(minRequiredBytes: number): MemoryCheckResult {
    const { total, used, free } = this.getMemoryStats();

    const memoryAvailableGB = bytesToGB(free).toFixed(2);
    const memoryTotalGB = bytesToGB(total).toFixed(2);
    const memoryUsedGB = bytesToGB(used).toFixed(2);
    const minRequiredGB = bytesToGB(minRequiredBytes).toFixed(2);

    if (free < minRequiredBytes) {
      return {
        available: false,
        message: `Insufficient memory: ${memoryAvailableGB}GB available, ${minRequiredGB}GB required. Please wait for other builds to complete or free up memory.`,
        details: {
          memoryTotal: total,
          memoryUsed: used,
          memoryFree: free,
          minRequired: minRequiredBytes,
          memoryTotalGB,
          memoryUsedGB,
          memoryAvailableGB,
          minRequiredGB,
        },
      };
    }

    return {
      available: true,
      message: `Memory check passed: ${memoryAvailableGB}GB available (${minRequiredGB}GB required)`,
      details: {
        memoryTotal: total,
        memoryUsed: used,
        memoryFree: free,
        minRequired: minRequiredBytes,
        memoryTotalGB,
        memoryUsedGB,
        memoryAvailableGB,
        minRequiredGB,
      },
    };
  }

  getCpuInfo() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();

    return {
      count: cpus.length,
      model: cpus[0]?.model || "Unknown",
      usage: Math.min(
        100,
        Math.round((loadAvg[0] / cpus.length) * 100 * 10) / 10
      ),
      loadAverage: {
        "1min": loadAvg[0],
        "5min": loadAvg[1],
        "15min": loadAvg[2],
      },
    };
  }

  getSystemInfo() {
    return {
      uptime: os.uptime(),
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      type: os.type(),
    };
  }
}
