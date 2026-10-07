import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { sessionActor } from "../../common/actor";
import type { PrismaService } from "../../common/prisma.service";
import { SpawnerConfig } from "../../common/spawner.config";
import type { AuditService } from "../audit/audit.service";
import { LimitsService } from "./limits.service";

const GiB = 1024 ** 3;
const admin = sessionActor({ id: 1, name: "Ada", role: "admin" });

function service(saved: string | null = null) {
  const rows = new Map<string, string>(saved ? [["limits", saved]] : []);
  const prisma = {
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) => (rows.has(where.key) ? { key: where.key, value: rows.get(where.key) } : null),
      upsert: async ({ where, create }: { where: { key: string }; create: { value: string } }) => rows.set(where.key, create.value),
    },
  };
  const config = new SpawnerConfig();
  const limits = new LimitsService(prisma as unknown as PrismaService, config, { record: async () => undefined } as unknown as AuditService);
  return { limits, config, rows };
}

describe("LimitsService", () => {
  it("applies the limits an admin changes, given as durations and sizes", async () => {
    const { limits, config, rows } = service();
    const view = await limits.update(admin, { idleSeconds: "30m", envsPerUser: 3, envMemoryBytes: "1g", buildMinFreeDiskBytes: "20g" });

    expect(view.values).toMatchObject({ idleSeconds: 1800, envsPerUser: 3, envMemoryBytes: GiB, buildMinFreeDiskBytes: 20 * GiB });
    expect(view.overridden.sort()).toEqual(["buildMinFreeDiskBytes", "envMemoryBytes", "envsPerUser", "idleSeconds"]);
    expect([config.envIdleSeconds, config.envsPerUser, config.composeLimits.envMemoryBytes, config.minFreeDiskBytes]).toEqual([1800, 3, GiB, 20 * GiB]);
    expect(JSON.parse(rows.get("limits") as string)).toEqual({ idleSeconds: 1800, envsPerUser: 3, envMemoryBytes: GiB, buildMinFreeDiskBytes: 20 * GiB });
  });

  it("goes back to the environment's value with null, and reloads saved limits at startup", async () => {
    const { limits, config } = service(JSON.stringify({ idleSeconds: 600, envsPerUser: 2 }));
    await limits.onModuleInit();
    expect([config.envIdleSeconds, config.envsPerUser]).toEqual([600, 2]);

    const view = await limits.update(admin, { envsPerUser: null, idleSeconds: "never" });
    expect(view.values.envsPerUser).toBe(view.defaults.envsPerUser);
    expect(config.envIdleSeconds).toBe(0);
  });

  it("refuses inconsistent limits and unknown ones", async () => {
    const { limits } = service();
    await expect(limits.update(admin, { ttlSeconds: "30d", ttlMaxSeconds: "14d" })).rejects.toThrow("must not exceed the maximum lifetime");
    await expect(limits.update(admin, { idleSeconds: "10s" })).rejects.toThrow("at least 1m");
    await expect(limits.update(admin, { envMemoryBytes: "8g" })).rejects.toThrow("must not exceed its maximum");
    await expect(limits.update(admin, { quota: 3 })).rejects.toBeInstanceOf(BadRequestException);
  });
});
