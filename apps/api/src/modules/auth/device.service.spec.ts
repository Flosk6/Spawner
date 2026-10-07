import { ForbiddenException, HttpException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it } from "vitest";
import { sessionActor, type Actor } from "../../common/actor";
import type { PrismaService } from "../../common/prisma.service";
import type { SpawnerConfig } from "../../common/spawner.config";
import type { AuditService } from "../audit/audit.service";
import type { TokensService } from "../tokens/tokens.service";
import { DeviceService, normalizeUserCode } from "./device.service";

interface Row {
  id: string;
  deviceCodeHash: string;
  userCode: string;
  clientName: string;
  status: string;
  userId: number | null;
  expiresAt: Date;
  lastPolledAt: Date | null;
}

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: HttpException) => (error.getResponse() as { error: string }).error,
  );

describe("DeviceService", () => {
  let rows: Row[];
  let issued: { userId: number; name: string; scopes: readonly string[] }[];
  let service: DeviceService;
  const ada = sessionActor({ id: 1, name: "Ada", role: "member" });

  beforeEach(() => {
    rows = [];
    issued = [];
    const find = (where: Partial<Row>) => rows.find((row) => Object.entries(where).every(([key, value]) => row[key as keyof Row] === value)) ?? null;
    const prisma = {
      deviceCode: {
        create: async ({ data }: { data: Row }) => rows.push({ ...data, id: `d${rows.length}`, status: "pending", userId: null, lastPolledAt: null }),
        findUnique: async ({ where }: { where: Partial<Row> }) => find(where),
        update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(find({ id: where.id }) as Row, data),
        updateMany: async ({ where, data }: { where: Partial<Row>; data: Partial<Row> }) => {
          const row = find(where);
          return { count: row ? (Object.assign(row, data), 1) : 0 };
        },
      },
      user: { findUnique: async () => ({ id: 1, name: "Ada", role: "member", isActive: true }) },
    };
    const tokens = {
      issue: async (userId: number, options: { name: string; scopes: readonly string[] }) => {
        issued.push({ userId, ...options });
        return { token: "spn_abcdefgh_secret", info: { id: "t1", name: options.name, scopes: options.scopes } };
      },
    };
    service = new DeviceService(
      prisma as unknown as PrismaService,
      tokens as unknown as TokensService,
      { dashboardUrl: "https://spawner.preview.example.com" } as SpawnerConfig,
      { record: async () => undefined } as unknown as AuditService,
    );
  });

  it("gives the CLI a token once its user approves the code in the dashboard", async () => {
    const started = await service.start("claude-laptop");
    expect(started).toMatchObject({ verificationUri: "https://spawner.preview.example.com/device", expiresIn: 600, interval: 5 });
    expect(started.userCode).toMatch(/^[B-DF-HJ-NP-TV-XZ]{4}-[B-DF-HJ-NP-TV-XZ]{4}$/);
    expect(await errorOf(service.poll(started.deviceCode))).toBe("authorization_pending");

    expect(await service.describe(ada, started.userCode.toLowerCase().replace("-", " "))).toMatchObject({ clientName: "claude-laptop" });
    await service.decide(ada, started.userCode, true);

    expect(await service.poll(started.deviceCode)).toMatchObject({ token: "spn_abcdefgh_secret", user: { id: 1 } });
    expect(issued).toEqual([{ userId: 1, name: "claude-laptop", scopes: ["envs:read", "envs:write", "envs:exec", "preview"], days: 90 }]);
    expect(await errorOf(service.poll(started.deviceCode))).toBe("invalid_grant");
  });

  it("tells a CLI that polls too fast to slow down", async () => {
    const { deviceCode } = await service.start("cli");
    await errorOf(service.poll(deviceCode));

    expect(await errorOf(service.poll(deviceCode))).toBe("slow_down");
  });

  it("reports a refused or expired login", async () => {
    const refused = await service.start("cli");
    await service.decide(ada, refused.userCode, false);
    expect(await errorOf(service.poll(refused.deviceCode))).toBe("access_denied");

    const late = await service.start("cli");
    rows[rows.length - 1].expiresAt = new Date(Date.now() - 1000);
    expect(await errorOf(service.poll(late.deviceCode))).toBe("expired_token");
    await expect(service.describe(ada, late.userCode)).rejects.toBeInstanceOf(NotFoundException);
    expect(await errorOf(service.poll("made-up"))).toBe("invalid_grant");
  });

  it("is approved from the dashboard only, not with a token", async () => {
    const { userCode } = await service.start("cli");
    const agent: Actor = { ...ada, via: "token", tokenId: "t", tokenName: "agent" };

    await expect(service.decide(agent, userCode, true)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("normalizeUserCode", () => {
  it("accepts the code as people type it", () => {
    expect(normalizeUserCode("bcdf-ghjk")).toBe("BCDF-GHJK");
    expect(normalizeUserCode(" BCDF GHJK ")).toBe("BCDF-GHJK");
    expect(normalizeUserCode("BCDF")).toBeNull();
    expect(normalizeUserCode(42)).toBeNull();
  });
});
