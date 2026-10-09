import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { AccessService } from "../../common/access.service";
import { assertScope, sessionActor, type Actor } from "../../common/actor";
import type { PrismaService } from "../../common/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { PasskeysService } from "../auth/passkeys.service";
import type { SettingsService } from "../settings/settings.service";
import { UsersService } from "./users.service";

describe("UsersService", () => {
  it("renames a user from a dashboard session only, to a name nobody else goes by, and records it", async () => {
    const names: string[] = [];
    const recorded: unknown[][] = [];
    const prisma = {
      user: {
        findFirst: async ({ where }: { where: { name: { equals: string }; NOT?: { id: number } } }) =>
          where.name.equals.toLowerCase() === "ada" && where.NOT?.id !== 1 ? { id: 1 } : null,
        update: async ({ data }: { data: { name: string } }) => {
          names.push(data.name);
          return { id: 2, name: data.name, role: "member", isActive: true, createdAt: new Date() };
        },
      },
    };
    const audit = { record: async (...args: unknown[]) => void recorded.push(args) };
    const users = new UsersService(prisma as unknown as PrismaService, {} as PasskeysService, {} as SettingsService, audit as unknown as AuditService, {} as AccessService);
    const session = sessionActor({ id: 2, name: "Bob", role: "member" });
    const token: Actor = { ...session, via: "token", tokenId: "t1", tokenName: "agent" };

    await expect(users.rename(token, "Robert")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(users.rename(session, " ADA ")).rejects.toThrow('someone is already named "ADA"');
    await expect(users.rename(session, "Ada via claude-laptop")).rejects.toThrow("via");
    await expect(users.rename(session, "Bob\u202e")).rejects.toThrow("control characters");
    await users.rename(session, "Robert");
    expect(names).toEqual(["Robert"]);
    expect(recorded).toEqual([[session, "user.rename", { target: "Robert", details: { userId: 2, from: "Bob" } }]]);
  });

  it("closes the terminals and streams of a user deactivated, and what a demoted admin may no longer do", async () => {
    const rows: Record<number, { id: number; name: string; role: string; isActive: boolean; createdAt: Date }> = {
      1: { id: 1, name: "Ada", role: "admin", isActive: true, createdAt: new Date() },
      2: { id: 2, name: "Bob", role: "admin", isActive: true, createdAt: new Date() },
    };
    const prisma = {
      user: {
        findUnique: async ({ where }: { where: { id: number } }) => rows[where.id] ?? null,
        count: async () => Object.values(rows).filter((row) => row.role === "admin" && row.isActive).length,
        update: async ({ where, data }: { where: { id: number }; data: object }) => Object.assign(rows[where.id], data),
      },
    };
    const access = new AccessService(prisma as unknown as PrismaService);
    const users = new UsersService(prisma as unknown as PrismaService, {} as PasskeysService, {} as SettingsService, { record: async () => undefined } as unknown as AuditService, access);
    const admin = sessionActor({ id: 1, name: "Ada", role: "admin" });
    const lost: string[] = [];
    access.watch(sessionActor({ id: 2, name: "Bob", role: "admin" }), (actor) => assertScope(actor, "admin"), (reason) => lost.push(`audit: ${reason}`));
    access.watch(sessionActor({ id: 2, name: "Bob", role: "admin" }), (actor) => assertScope(actor, "envs:exec"), (reason) => lost.push(`terminal: ${reason}`));

    await users.update(admin, 2, { role: "member" });
    expect(lost).toEqual(["audit: this needs the admin scope"]);
    await users.update(admin, 2, { isActive: false });
    expect(lost).toEqual(["audit: this needs the admin scope", "terminal: access revoked or expired"]);
    access.onModuleDestroy();
  });
});
