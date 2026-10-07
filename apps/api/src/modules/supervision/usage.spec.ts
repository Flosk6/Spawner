import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { sessionActor } from "../../common/actor";
import { LimitReachedException } from "../../common/limit-reached";
import type { PrismaService } from "../../common/prisma.service";
import type { SpawnerConfig } from "../../common/spawner.config";
import type { TimelineService } from "../timeline/timeline.service";
import type { DiskService } from "./disk.service";
import type { MetricsCollector } from "./metrics-collector.service";
import { downsample, parseRange, UsageService } from "./usage.service";

describe("charts", () => {
  it("averages a long series down to a readable number of points", () => {
    const points = Array.from({ length: 10 }, (_, index) => ({
      time: new Date(index * 60_000),
      cpuPercent: index,
      memoryBytes: index * 100,
      services: { api: { cpu: index, memory: index * 100 } },
    }));
    const sampled = downsample(points, 5);
    expect(sampled).toHaveLength(5);
    expect(sampled[0]).toMatchObject({ time: new Date(0), cpuPercent: 0.5, memoryBytes: 50, memoryMaxBytes: 100, services: { api: { cpu: 0.5, memory: 50 } } });
    expect(downsample(points, 20)).toBe(points);
  });

  it("knows its ranges", () => {
    expect(parseRange(undefined, "24h")).toBe("24h");
    expect(parseRange("7d", "24h")).toBe("7d");
    expect(() => parseRange("2y", "24h")).toThrow(BadRequestException);
  });
});

describe("room for one more environment", () => {
  const GiB = 1024 ** 3;
  const ada = sessionActor({ id: 7, name: "Ada", role: "member" });

  function usage(options: { owned: number; availableMemory: number; freeDisk: number; typicalMemory: number }) {
    const prisma = {
      environment: {
        count: async () => options.owned,
        findMany: async () => [{ id: "env-1", projectId: "p1", manifest: null }],
      },
      $queryRaw: async () => [{ project_id: "p1", environment_id: "env-1", memory: options.typicalMemory }],
    };
    const collector = { host: () => ({ host: { memory: { availableBytes: options.availableMemory }, disk: { freeBytes: options.freeDisk } } }) };
    const disk = { latest: async () => ({ details: { environments: { "env-1": { totalBytes: GiB } } } }) };
    return new UsageService(
      prisma as unknown as PrismaService,
      { envsPerUser: 3, composeLimits: { envMemoryBytes: 2 * GiB } } as unknown as SpawnerConfig,
      collector as unknown as MetricsCollector,
      disk as unknown as DiskService,
      {} as TimelineService,
    );
  }

  it("lets an environment in while the quota, the memory and the disk allow it", async () => {
    await expect(usage({ owned: 2, availableMemory: 3 * GiB, freeDisk: 20 * GiB, typicalMemory: GiB }).ensureRoom("p1", "create", ada)).resolves.toBeUndefined();
  });

  it("refuses beyond the quota of a person, with the code quota", async () => {
    const refusal = await usage({ owned: 3, availableMemory: 8 * GiB, freeDisk: 50 * GiB, typicalMemory: GiB }).ensureRoom("p1", "create", ada).catch((error) => error);
    expect(refusal).toBeInstanceOf(LimitReachedException);
    expect(refusal.getStatus()).toBe(409);
    expect(refusal.getResponse()).toMatchObject({ code: "quota" });
  });

  it("refuses without the memory of a typical environment, the reserve kept; the disk only counts for a new one", async () => {
    const short = usage({ owned: 0, availableMemory: 1.5 * GiB, freeDisk: 50 * GiB, typicalMemory: GiB });
    const refusal = await short.ensureRoom("p1", "resume", ada).catch((error) => error);
    expect(refusal.getStatus()).toBe(503);
    expect(refusal.getResponse()).toMatchObject({ code: "capacity" });

    const fullDisk = usage({ owned: 0, availableMemory: 8 * GiB, freeDisk: 10.5 * GiB, typicalMemory: GiB });
    await expect(fullDisk.ensureRoom("p1", "resume", ada)).resolves.toBeUndefined();
    await expect(fullDisk.ensureRoom("p1", "create", ada)).rejects.toThrow("Not enough disk");
  });
});
