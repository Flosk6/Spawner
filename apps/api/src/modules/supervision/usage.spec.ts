import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { downsample, parseRange } from "./usage.service";

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
