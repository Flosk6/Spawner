import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it } from "vitest";
import { sessionActor, type Actor } from "../../common/actor";
import type { PrismaService } from "../../common/prisma.service";
import { sha256 } from "../../common/secrets.service";
import type { AuditService } from "../audit/audit.service";
import { TokensService } from "./tokens.service";

interface Row {
  id: string;
  userId: number;
  name: string;
  prefix: string;
  hash: string;
  scopes: string[];
  projectId: string | null;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

describe("TokensService", () => {
  let rows: Map<string, Row>;
  let users: Record<number, { id: number; name: string; role: string; isActive: boolean }>;
  let service: TokensService;
  const admin = sessionActor({ id: 1, name: "Ada", role: "admin" });
  const member = sessionActor({ id: 2, name: "Bob", role: "member" });

  beforeEach(() => {
    rows = new Map();
    users = { 1: { id: 1, name: "Ada", role: "admin", isActive: true }, 2: { id: 2, name: "Bob", role: "member", isActive: true } };
    const projects = [{ id: "p1", slug: "blog" }];
    const withRelations = (row: Row | undefined) => (row ? { ...row, user: users[row.userId], project: projects.find((project) => project.id === row.projectId) ?? null } : null);
    const prisma = {
      apiToken: {
        create: async ({ data }: { data: Omit<Row, "id" | "createdAt" | "lastUsedAt" | "revokedAt"> }) => {
          const row = { ...data, id: `t${rows.size + 1}`, createdAt: new Date(), lastUsedAt: null, revokedAt: null } as Row;
          rows.set(row.id, row);
          return withRelations(row);
        },
        findUnique: async ({ where }: { where: { id?: string; prefix?: string } }) =>
          withRelations(where.id ? rows.get(where.id) : [...rows.values()].find((row) => row.prefix === where.prefix)),
        findMany: async ({ where }: { where: { userId?: number } }) =>
          [...rows.values()].filter((row) => !row.revokedAt && (where.userId === undefined || row.userId === where.userId)).map(withRelations),
        update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(rows.get(where.id) as Row, data),
      },
      project: { findUnique: async ({ where }: { where: { slug: string } }) => projects.find((project) => project.slug === where.slug) ?? null },
    };
    service = new TokensService(prisma as unknown as PrismaService, { record: async () => undefined } as unknown as AuditService);
  });

  it("creates spn_<prefix>_<secret> tokens and stores only their hash", async () => {
    const { token, info } = await service.create(member, { name: "claude-laptop" });

    expect(token).toMatch(/^spn_[a-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    const row = rows.get(info.id) as Row;
    expect(row.hash).toBe(sha256(token));
    expect(JSON.stringify(row)).not.toContain(token.split("_")[2]);
    expect(info).toMatchObject({ name: "claude-laptop", hint: `spn_${row.prefix}_...`, scopes: ["envs:read", "envs:write", "envs:exec", "preview"] });
    expect(Math.round((row.expiresAt!.getTime() - Date.now()) / 86_400_000)).toBe(90);
  });

  it("authenticates a token as its user, with its scopes", async () => {
    const { token } = await service.create(admin, { name: "ci", scopes: ["envs:read", "admin"], project: "blog" });
    const actor = (await service.authenticate(token)) as Actor;

    expect(actor).toMatchObject({ user: { id: 1, name: "Ada" }, via: "token", scopes: ["envs:read", "admin"], tokenName: "ci", projectId: "p1" });
    expect(await service.authenticate(`${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`)).toBeNull();
    expect(await service.authenticate("spn_nothere1_" + "a".repeat(43))).toBeNull();
  });

  it("never gives more than the creator has", async () => {
    await expect(service.create(member, { name: "x", scopes: ["admin"] })).rejects.toBeInstanceOf(ForbiddenException);
    const agent: Actor = { ...member, via: "token", scopes: ["envs:read"], tokenId: "t9", tokenName: "agent", projectId: "p1" };
    await expect(service.create(agent, { name: "x", scopes: ["envs:write"] })).rejects.toBeInstanceOf(ForbiddenException);
    expect((await service.create(agent, { name: "x", scopes: ["envs:read"] })).info.project).toBe("blog");
  });

  it("checks names, scopes and lifetimes", async () => {
    for (const request of [{ name: "" }, { name: "x".repeat(41) }, { name: "x", scopes: [] }, { name: "x", scopes: ["root"] }, { name: "x", expiresInDays: 0 }, { name: "x", expiresInDays: 400 }, { name: "x", project: "nope" }]) {
      await expect(service.create(member, request)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it("stops accepting a token once revoked, expired, or its user deactivated", async () => {
    const revoked = await service.create(member, { name: "a" });
    await service.revoke(member, revoked.info.id);
    expect(await service.authenticate(revoked.token)).toBeNull();

    const expired = await service.create(member, { name: "b" });
    (rows.get(expired.info.id) as Row).expiresAt = new Date(Date.now() - 1000);
    expect(await service.authenticate(expired.token)).toBeNull();

    const active = await service.create(member, { name: "c" });
    users[2].isActive = false;
    expect(await service.authenticate(active.token)).toBeNull();
  });

  it("drops the admin scope of a token when its user is no longer admin", async () => {
    const { token } = await service.create(admin, { name: "ops", scopes: ["admin", "envs:read"] });
    users[1].role = "member";

    expect((await service.authenticate(token))?.scopes).toEqual(["envs:read"]);
  });

  it("lets users revoke their own tokens, and admins anyone's", async () => {
    const theirs = await service.create(admin, { name: "a" });
    await expect(service.revoke(member, theirs.info.id)).rejects.toBeInstanceOf(NotFoundException);
    const mine = await service.create(member, { name: "b" });
    await service.revoke(admin, mine.info.id);
    expect((await service.list(member, false)).map((token) => token.name)).toEqual([]);
  });
});
