import { describe, expect, it } from "vitest";
import { detectCrashLoops } from "../timeline/timeline.service";
import { interpretDockerEvent, type DockerEvent, type EventContext } from "./docker-events.service";

const event = (Action: string, attributes: Record<string, string> = {}): DockerEvent => ({
  Type: "container",
  Action,
  Actor: { ID: "c1", Attributes: { "com.docker.compose.service": "api", "dev.spawner.env": "env-1", ...attributes } },
  time: 1,
});
const quiet: EventContext = { jobRunning: false, afterOom: false, wasUnhealthy: false };

describe("interpretDockerEvent", () => {
  it("records crashes, out-of-memory kills and failed healthchecks", () => {
    expect(interpretDockerEvent(event("die", { exitCode: "1" }), quiet)).toEqual({ type: "crash", message: "api crashed (exit code 1)", details: { exitCode: 1 } });
    expect(interpretDockerEvent(event("oom"), { ...quiet, memoryLimitBytes: 512 * 1024 ** 2 })).toEqual({
      type: "oom",
      message: "api ran out of memory (limit 512 MiB)",
      details: { limitBytes: 512 * 1024 ** 2 },
    });
    expect(interpretDockerEvent(event("health_status: unhealthy"), { ...quiet, healthOutput: "curl: (7) Failed to connect" })?.message).toBe(
      "api is unhealthy: curl: (7) Failed to connect",
    );
  });

  it("leaves out what is expected or already said", () => {
    expect(interpretDockerEvent(event("die", { exitCode: "143" }), { ...quiet, jobRunning: true })).toBeNull();
    expect(interpretDockerEvent(event("die", { exitCode: "1" }), { ...quiet, jobRunning: true })?.type).toBe("crash");
    expect(interpretDockerEvent(event("die", { exitCode: "137" }), { ...quiet, afterOom: true })).toBeNull();
    expect(interpretDockerEvent(event("health_status: healthy"), quiet)).toBeNull();
    expect(interpretDockerEvent(event("health_status: healthy"), { ...quiet, wasUnhealthy: true })?.message).toBe("api is healthy again");
    expect(interpretDockerEvent(event("start"), quiet)).toBeNull();
  });
});

describe("detectCrashLoops", () => {
  const at = (seconds: number) => new Date(Date.UTC(2026, 9, 7, 10, 0, seconds));
  it("finds a service that crashed three times, an out-of-memory kill and its exit counted once", () => {
    const loops = detectCrashLoops([
      { environmentId: "e", service: "api", type: "crash", time: at(0), details: { exitCode: 1 } },
      { environmentId: "e", service: "api", type: "oom", time: at(20), details: { limitBytes: 256 * 1024 ** 2 } },
      { environmentId: "e", service: "api", type: "crash", time: at(21), details: { exitCode: 137 } },
      { environmentId: "e", service: "api", type: "oom", time: at(40), details: { limitBytes: 256 * 1024 ** 2 } },
      { environmentId: "e", service: "db", type: "crash", time: at(41), details: { exitCode: 1 } },
    ]);
    expect(loops.get("e")).toEqual([{ service: "api", count: 3, windowMinutes: 10, lastCause: "out of memory (limit 256 MiB)", lastAt: at(40) }]);
  });
});
