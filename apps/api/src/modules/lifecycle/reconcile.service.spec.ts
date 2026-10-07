import { describe, expect, it } from "vitest";
import type { DockerService } from "../../common/docker.service";
import type { PrismaService } from "../../common/prisma.service";
import type { SpawnerConfig } from "../../common/spawner.config";
import type { TimelineService } from "../timeline/timeline.service";
import type { CleanupService } from "./cleanup.service";
import { containerProblems, ReconcileService } from "./reconcile.service";

const container = (env: string, service: string, State: string, Status: string) => ({
  Labels: { "dev.spawner.env": env, "dev.spawner.service": service },
  State,
  Status,
});

describe("containerProblems", () => {
  it("names the services that do not run, or run unhealthy", () => {
    expect(
      containerProblems([
        container("a", "web", "running", "Up 3 minutes (healthy)"),
        container("a", "api", "exited", "Exited (1) 2 minutes ago"),
        container("a", "db", "restarting", "Restarting (137) 1 second ago"),
        container("a", "worker", "running", "Up 1 minute (unhealthy)"),
      ]),
    ).toEqual(["api exited with code 1", "db is restarting", "worker is unhealthy"]);
  });
});

describe("ReconcileService", () => {
  it("marks environments degraded, ready again, failed without containers or without a job", async () => {
    const updates: { id: string; data: Record<string, unknown> }[] = [];
    const events: string[] = [];
    const prisma = {
      environment: {
        findMany: async () => [
          { id: "down", status: "ready", error: null, expiresAt: new Date() },
          { id: "back", status: "degraded", error: "api exited with code 1", expiresAt: new Date() },
          { id: "gone", status: "ready", error: null, expiresAt: null },
          { id: "stuck", status: "building", error: null, expiresAt: new Date() },
          { id: "fine", status: "ready", error: null, expiresAt: new Date() },
        ],
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => updates.push({ id: where.id, data }),
      },
    };
    const docker = {
      client: {
        listContainers: async () => [
          container("down", "api", "exited", "Exited (1) 5 seconds ago"),
          container("down", "web", "running", "Up 1 hour"),
          container("back", "api", "running", "Up 10 seconds"),
          container("stuck", "api", "running", "Up 1 hour"),
          container("fine", "web", "running", "Up 1 hour"),
        ],
      },
    };
    const reconcile = new ReconcileService(
      prisma as unknown as PrismaService,
      docker as unknown as DockerService,
      { envTtlSeconds: 3600 } as SpawnerConfig,
      { record: async (_id: string, type: string) => events.push(type) } as unknown as TimelineService,
      {} as CleanupService,
    );

    await reconcile.states();

    expect(updates.map((update) => [update.id, update.data.status, update.data.error])).toEqual([
      ["down", "degraded", "api exited with code 1"],
      ["back", "ready", null],
      ["gone", "failed", "its containers are gone (removed outside Spawner): redeploy it"],
      ["stuck", "failed", "interrupted while building: no job runs for it any more"],
    ]);
    expect(updates.find((update) => update.id === "gone")?.data.expiresAt).toBeInstanceOf(Date);
    expect(events).toEqual(["crash"]);
  });
});
