import { describe, expect, it } from "vitest";
import type { PrismaService } from "../../common/prisma.service";
import type { SpawnerConfig } from "../../common/spawner.config";
import type { AuditService } from "../audit/audit.service";
import type { JobQueueService } from "../engine/job-queue.service";
import { formatDuration, idleSecondsOf, LifecycleService } from "./lifecycle.service";

const HOUR = 3600_000;
const now = new Date("2026-10-07T12:00:00Z");

function service(environments: Record<string, unknown>[], idleSeconds = 2 * 3600) {
  const queued: { id: string; type: string; actor: string | null }[] = [];
  const audited: string[] = [];
  const prisma = { environment: { findMany: async () => environments } };
  const queue = { enqueue: async (id: string, type: string, _payload: unknown, _by: unknown, actor: string | null) => queued.push({ id, type, actor }) };
  const audit = { record: async (_actor: unknown, action: string) => audited.push(action) };
  const lifecycle = new LifecycleService(
    prisma as unknown as PrismaService,
    { envIdleSeconds: idleSeconds } as SpawnerConfig,
    queue as unknown as JobQueueService,
    audit as unknown as AuditService,
  );
  return { lifecycle, queued, audited };
}

describe("LifecycleService", () => {
  it("puts to sleep the environments idle for longer than their idle time", async () => {
    const { lifecycle, queued } = service([
      { id: "idle", manifest: {}, lastActivityAt: new Date(now.getTime() - 3 * HOUR), updatedAt: now },
      { id: "busy", manifest: {}, lastActivityAt: new Date(now.getTime() - HOUR), updatedAt: now },
      { id: "short", manifest: { idle: 1800 }, lastActivityAt: new Date(now.getTime() - HOUR), updatedAt: now },
      { id: "never", manifest: { idle: "never" }, lastActivityAt: new Date(now.getTime() - 48 * HOUR), updatedAt: now },
      { id: "fresh", manifest: null, lastActivityAt: null, updatedAt: new Date(now.getTime() - 10 * 60_000) },
    ]);
    expect(await lifecycle.sleepIdle(now)).toEqual(["idle", "short"]);
    expect(queued).toEqual([
      { id: "idle", type: "sleep", actor: "Spawner (no activity for 2h)" },
      { id: "short", type: "sleep", actor: "Spawner (no activity for 30m)" },
    ]);
  });

  it("never puts anything to sleep when the server turned sleeping off", async () => {
    const { lifecycle, queued } = service([{ id: "idle", manifest: {}, lastActivityAt: new Date(0), updatedAt: now }], 0);
    expect(await lifecycle.sleepIdle(now)).toEqual([]);
    expect(queued).toEqual([]);
  });

  it("deletes the expired environments, and audits it", async () => {
    const { lifecycle, queued, audited } = service([{ id: "old", slug: "feat-a", project: { slug: "blog" } }]);
    expect(await lifecycle.expire(now)).toEqual(["old"]);
    expect(queued).toEqual([{ id: "old", type: "delete", actor: "Spawner (expired)" }]);
    expect(audited).toEqual(["env.expire"]);
  });

  it("reads idle times and writes durations", () => {
    expect(idleSecondsOf({ idle: "never" }, 7200)).toBe(0);
    expect(idleSecondsOf({ idle: 900 }, 7200)).toBe(900);
    expect(idleSecondsOf(null, 7200)).toBe(7200);
    expect([formatDuration(7200), formatDuration(2700), formatDuration(86_400 + 6 * 3600), formatDuration(30)]).toEqual(["2h", "45m", "1d 6h", "30s"]);
  });
});
