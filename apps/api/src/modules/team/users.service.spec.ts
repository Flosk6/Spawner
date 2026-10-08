import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { sessionActor, type Actor } from "../../common/actor";
import type { PrismaService } from "../../common/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { PasskeysService } from "../auth/passkeys.service";
import type { SettingsService } from "../settings/settings.service";
import { UsersService } from "./users.service";

describe("UsersService", () => {
  it("renames a user from a dashboard session only", async () => {
    const names: string[] = [];
    const prisma = {
      user: {
        update: async ({ data }: { data: { name: string } }) => {
          names.push(data.name);
          return { id: 2, name: data.name, role: "member", isActive: true, createdAt: new Date() };
        },
      },
    };
    const users = new UsersService(prisma as unknown as PrismaService, {} as PasskeysService, {} as SettingsService, {} as AuditService);
    const session = sessionActor({ id: 2, name: "Bob", role: "member" });
    const token: Actor = { ...session, via: "token", tokenId: "t1", tokenName: "agent" };

    await expect(users.rename(token, "Ada")).rejects.toBeInstanceOf(ForbiddenException);
    await users.rename(session, "Robert");
    expect(names).toEqual(["Robert"]);
  });
});
