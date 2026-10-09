import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AccessService } from "./access.service";
import { assertScope, bootstrapActor, sessionActor, tokenActor, type Actor } from "./actor";
import type { PrismaService } from "./prisma.service";

interface UserRow {
  id: number;
  name: string;
  role: string;
  isActive: boolean;
}

interface TokenRow {
  id: string;
  userId: number;
  name: string;
  scopes: string[];
  projectId: string | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
}

describe("AccessService", () => {
  let users: Record<number, UserRow>;
  let tokens: Record<string, TokenRow>;
  let failing: boolean;
  const read = <T>(value: T): T => {
    if (failing) {
      throw new Error("database unreachable");
    }
    return value;
  };
  const prisma = {
    user: { findUnique: async ({ where }: { where: { id: number } }) => read(users[where.id] ?? null) },
    apiToken: {
      findUnique: async ({ where }: { where: { id: string } }) => read(tokens[where.id] ? { ...tokens[where.id], user: users[tokens[where.id].userId] } : null),
    },
  };
  const access = new AccessService(prisma as unknown as PrismaService);
  const ada = () => sessionActor({ id: 1, name: "Ada", role: "admin" });
  const bob = () => sessionActor({ id: 2, name: "Bob", role: "member" });
  const agent = () => tokenActor({ ...tokens.t1, user: users[2] }) as Actor;

  beforeEach(() => {
    failing = false;
    users = { 1: { id: 1, name: "Ada", role: "admin", isActive: true }, 2: { id: 2, name: "Bob", role: "member", isActive: true } };
    tokens = {
      t1: { id: "t1", userId: 2, name: "claude-laptop", scopes: ["envs:read", "envs:exec", "admin"], projectId: "p1", revokedAt: null, expiresAt: new Date(Date.now() + 3600_000) },
    };
  });

  afterAll(() => access.onModuleDestroy());

  it("reads a session's user again: gone once deactivated, narrowed once demoted, never widened", async () => {
    expect((await access.refresh(ada()))?.scopes).toContain("admin");
    users[1].role = "member";
    expect(await access.refresh(ada())).toMatchObject({ user: { role: "member" }, scopes: ["envs:read", "envs:write", "envs:exec", "preview"] });
    users[1].isActive = false;
    expect(await access.refresh(ada())).toBeNull();

    users[2].role = "admin";
    expect((await access.refresh(bob()))?.scopes).not.toContain("admin");
  });

  it("reads a token again: gone once revoked or expired, kept within its project and without admin", async () => {
    expect(await access.refresh(agent())).toMatchObject({ via: "token", tokenId: "t1", projectId: "p1", scopes: ["envs:read", "envs:exec"] });
    const opened = agent();
    tokens.t1.expiresAt = new Date(Date.now() - 1000);
    expect(await access.refresh(opened)).toBeNull();
    tokens.t1.expiresAt = null;
    tokens.t1.revokedAt = new Date();
    expect(await access.refresh(opened)).toBeNull();
    expect(await access.refresh(bootstrapActor())).toEqual(bootstrapActor());
  });

  it("ends a watched connection once, when its own user loses access", async () => {
    const lost: string[] = [];
    access.watch(ada(), (actor) => assertScope(actor, "admin"), (reason) => lost.push(`ada: ${reason}`));
    access.watch(bob(), (actor) => assertScope(actor, "envs:read"), (reason) => lost.push(`bob: ${reason}`));

    users[1].role = "member";
    await access.changed(2);
    expect(lost).toEqual([]);
    await access.changed(1);
    await access.changed(1);
    expect(lost).toEqual(["ada: this needs the admin scope"]);

    users[2].isActive = false;
    await access.changed(2);
    expect(lost).toEqual(["ada: this needs the admin scope", "bob: access revoked or expired"]);
  });

  it("checks every connection again for expiries, and keeps them while the database fails", async () => {
    const lost: string[] = [];
    access.watch(agent(), () => undefined, (reason) => lost.push(reason));
    tokens.t1.expiresAt = new Date(Date.now() - 1000);
    failing = true;
    await access.recheck();
    expect(lost).toEqual([]);
    failing = false;
    await access.recheck();
    expect(lost).toEqual(["access revoked or expired"]);
  });

  it("forgets a connection that closed on its own", async () => {
    const lost: string[] = [];
    const unwatch = access.watch(bob(), () => undefined, (reason) => lost.push(reason));
    unwatch();
    users[2].isActive = false;
    await access.changed(2);
    expect(lost).toEqual([]);
  });
});
