import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { HostReader, hostCpuPercent, parseCpuTimes, parseMeminfo } from "./host";
import { cpuCounters, cpuPercent, memoryBytes, MinuteBucket } from "./samples";

const MiB = 1024 ** 2;

describe("container samples", () => {
  it("computes the CPU between two samples as docker stats does", () => {
    const first = cpuCounters({ cpu_stats: { cpu_usage: { total_usage: 1_000_000_000 }, system_cpu_usage: 100_000_000_000, online_cpus: 4 } });
    const second = cpuCounters({ cpu_stats: { cpu_usage: { total_usage: 1_500_000_000 }, system_cpu_usage: 102_000_000_000, online_cpus: 4 } });
    expect(cpuPercent(first, second)).toBe(100);
    expect(cpuPercent(undefined, second)).toBeNull();
    expect(cpuPercent(second, first)).toBe(0);
  });

  it("leaves the reclaimable page cache out of the memory", () => {
    expect(memoryBytes({ memory_stats: { usage: 300 * MiB, stats: { inactive_file: 100 * MiB } } })).toBe(200 * MiB);
    expect(memoryBytes({ memory_stats: { usage: 300 * MiB, stats: { total_inactive_file: 50 * MiB } } })).toBe(250 * MiB);
    expect(memoryBytes({})).toBe(0);
  });
});

describe("MinuteBucket", () => {
  it("averages each service, then sums the services of an environment", () => {
    const bucket = new MinuteBucket(0);
    bucket.add("env:a", { service: "api", cpuPercent: 10, memoryBytes: 100, memoryLimitBytes: 512 });
    bucket.add("env:a", { service: "api", cpuPercent: 30, memoryBytes: 300, memoryLimitBytes: 512 });
    bucket.add("env:a", { service: "db", cpuPercent: null, memoryBytes: 50, memoryLimitBytes: 256 });
    bucket.add("host", { cpuPercent: 40, memoryBytes: 1000, memoryLimitBytes: 4000 });
    bucket.add("host", { cpuPercent: 60, memoryBytes: 3000, memoryLimitBytes: 4000 });
    const averages = bucket.averages();
    expect(averages.get("env:a")).toEqual({
      cpuPercent: 20,
      memoryBytes: 250,
      memoryLimitBytes: 768,
      services: { api: { cpu: 20, memory: 200 }, db: { cpu: 0, memory: 50 } },
    });
    expect(averages.get("host")).toEqual({ cpuPercent: 50, memoryBytes: 2000, memoryLimitBytes: 4000, services: {} });
  });
});

describe("host", () => {
  it("reads /proc/meminfo and /proc/stat", () => {
    expect(parseMeminfo("MemTotal:       8000000 kB\nMemAvailable:   6000000 kB\nHugePages_Total:       0\n")).toEqual({
      MemTotal: 8000000 * 1024,
      MemAvailable: 6000000 * 1024,
      HugePages_Total: 0,
    });
    const first = parseCpuTimes("cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1 2 3");
    const second = parseCpuTimes("cpu  200 0 200 1400 200 0 0 0 0 0\n");
    expect(first).toEqual({ busy: 200, total: 1000 });
    expect(hostCpuPercent(first, second)).toBe(20);
  });

  it("reads a fake /proc, then the disk of the data directory", () => {
    const proc = fs.mkdtempSync(path.join(os.tmpdir(), "proc-"));
    fs.writeFileSync(path.join(proc, "meminfo"), "MemTotal: 4096 kB\nMemFree: 1024 kB\nMemAvailable: 2048 kB\nCached: 512 kB\nSwapTotal: 1024 kB\nSwapFree: 256 kB\n");
    fs.writeFileSync(path.join(proc, "stat"), "cpu  100 0 100 800 0 0 0 0\n");
    const reader = new HostReader(proc, proc);
    const first = reader.read();
    expect(first.memory).toEqual({ totalBytes: 4096 * 1024, availableBytes: 2048 * 1024, cacheBytes: 512 * 1024, swapTotalBytes: 1024 * 1024, swapUsedBytes: 768 * 1024 });
    expect(first.cpuPercent).toBeNull();
    expect(first.disk.totalBytes).toBeGreaterThan(0);
    fs.writeFileSync(path.join(proc, "stat"), "cpu  150 0 150 900 0 0 0 0\n");
    expect(reader.read().cpuPercent).toBe(50);
  });
});
