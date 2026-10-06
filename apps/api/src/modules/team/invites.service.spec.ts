import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { Request } from "express";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaService } from "../../common/prisma.service";
import type { SpawnerConfig } from "../../common/spawner.config";
import { SoftAuthenticator } from "../../testing/soft-authenticator";
import type { AuditService } from "../audit/audit.service";
import { PasskeysService } from "../auth/passkeys.service";
import type { SessionsService } from "../auth/sessions.service";
import { InvitesService } from "./invites.service";

const ORIGIN = "https://spawner.preview.example.com";

interface UserRow {
  id: number;
  name: string;
  role: string;
  isActive: boolean;
  webauthnId: string | null;
}

/** Users, invitations and passkeys in memory, with the Prisma calls the services make. */
function fakeDatabase() {
  const users: UserRow[] = [];
  const invites: Record<string, unknown>[] = [];
  const passkeys: Record<string, unknown>[] = [];
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => (value && typeof value === "object" && "not" in value ? row[key] !== (value as { not: unknown }).not : row[key] === value));
  const db = {
    users,
    passkeys,
    user: {
      create: async ({ data }: { data: Omit<UserRow, "id" | "isActive" | "webauthnId"> }) => {
        const user = { ...data, id: users.length + 1, isActive: true, webauthnId: null };
        users.push(user);
        return user;
      },
      findUnique: async ({ where }: { where: { id: number } }) => users.find((user) => user.id === where.id) ?? null,
      findFirst: async ({ where }: { where: Record<string, unknown> }) => users.find((user) => matches(user as never, where)) ?? null,
      update: async ({ where, data }: { where: { id: number }; data: Partial<UserRow> }) => Object.assign(users.find((user) => user.id === where.id) as UserRow, data),
    },
    invite: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const invite = { ...data, id: `i${invites.length + 1}`, usedAt: null, revokedAt: null, createdAt: new Date() };
        invites.push(invite);
        return invite;
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        const invite = invites.find((row) => row.tokenHash === where.tokenHash);
        return invite ? { ...invite, user: users.find((user) => user.id === invite.userId) ?? null } : null;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const invite = invites.find((row) => matches(row, where));
        return { count: invite ? (Object.assign(invite, data), 1) : 0 };
      },
    },
    passkey: {
      create: async ({ data }: { data: Record<string, unknown> }) => (passkeys.push(data), data),
      findMany: async ({ where }: { where: { userId: number } }) => passkeys.filter((passkey) => passkey.userId === where.userId),
    },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(db),
  };
  return db;
}

describe("InvitesService", () => {
  let db: ReturnType<typeof fakeDatabase>;
  let logins: { userId: number; method: string }[];
  let authenticator: SoftAuthenticator;

  const service = (tls: "letsencrypt" | "off") => {
    const config = { dashboardUrl: ORIGIN, dashboardOrigins: [ORIGIN], tls } as SpawnerConfig;
    const sessions = { login: async (_request: Request, user: { id: number }, method: string) => logins.push({ userId: user.id, method }) };
    return new InvitesService(
      db as unknown as PrismaService,
      new PasskeysService(db as unknown as PrismaService, config),
      sessions as unknown as SessionsService,
      config,
      { record: async () => undefined } as unknown as AuditService,
    );
  };
  const request = () => ({ headers: { origin: ORIGIN }, session: {} }) as unknown as Request;
  const tokenOf = (url: string) => url.split("/invite/")[1];

  beforeEach(() => {
    db = fakeDatabase();
    logins = [];
    authenticator = new SoftAuthenticator();
  });

  it("creates an account with a passkey, then logs the new user in", async () => {
    const invites = service("letsencrypt");
    const { url } = await invites.create(null, { role: "admin", note: "first admin" });
    const token = tokenOf(url);
    expect(url).toMatch(/^https:\/\/spawner\.preview\.example\.com\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(await invites.describe(token)).toMatchObject({ role: "admin", note: "first admin", passkeyRequired: true });

    const browser = request();
    const options = await invites.passkeyOptions(browser, token, "Ada");
    const result = await invites.accept(browser, token, { name: "Ada", credential: authenticator.register(options, ORIGIN), passkeyName: "MacBook" });

    expect(result.user).toEqual({ id: 1, name: "Ada", role: "admin" });
    expect(db.passkeys).toMatchObject([{ userId: 1, name: "MacBook" }]);
    expect(db.users[0].webauthnId).toBe(options.user.id);
    expect(logins).toEqual([{ userId: 1, method: "invite" }]);
  });

  it("works once", async () => {
    const invites = service("off");
    const token = tokenOf((await invites.create(null, {})).url);
    await invites.accept(request(), token, { name: "Bob" });

    await expect(invites.accept(request(), token, { name: "Eve" })).rejects.toBeInstanceOf(NotFoundException);
    await expect(invites.describe(token)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("requires a passkey over HTTPS, and logs in without one on a local install", async () => {
    const token = tokenOf((await service("letsencrypt").create(null, {})).url);
    await expect(service("letsencrypt").accept(request(), token, { name: "Bob" })).rejects.toBeInstanceOf(BadRequestException);

    expect((await service("off").accept(request(), token, { name: "Bob" })).user).toMatchObject({ name: "Bob", role: "member" });
    expect(db.passkeys).toEqual([]);
  });

  it("refuses expired invitations and checks what an admin asks for", async () => {
    const invites = service("off");
    const token = tokenOf((await invites.create(null, { ttlHours: 1 })).url);
    await db.invite.updateMany({ where: {}, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(invites.describe(token)).rejects.toBeInstanceOf(NotFoundException);

    for (const request of [{ role: "owner" }, { ttlHours: 0 }, { ttlHours: 1000 }, { note: "x".repeat(101) }]) {
      await expect(invites.create(null, request)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it("gives an existing user a new passkey, keeping their account", async () => {
    const invites = service("letsencrypt");
    const ada = await db.user.create({ data: { name: "Ada", role: "admin" } });
    const { url, note } = await invites.create(null, { userId: ada.id });
    expect(note).toBe("new passkey for Ada");

    const browser = request();
    const options = await invites.passkeyOptions(browser, tokenOf(url), "ignored");
    expect(options.user.name).toBe("Ada");
    const result = await invites.accept(browser, tokenOf(url), { credential: authenticator.register(options, ORIGIN) });

    expect(result.user).toEqual({ id: ada.id, name: "Ada", role: "admin" });
    expect(db.users).toHaveLength(1);
    expect(db.passkeys).toMatchObject([{ userId: ada.id }]);
  });
});
