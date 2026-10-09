import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Request } from "express";
import { AccessService } from "../../common/access.service";
import { isRole, type Actor } from "../../common/actor";
import { PrismaService } from "../../common/prisma.service";
import { randomToken } from "../../common/secrets.service";
import { AuditService } from "../audit/audit.service";
import { presentUser } from "../auth/present";
import { PasskeysService } from "../auth/passkeys.service";
import { SettingsService } from "../settings/settings.service";

/**
 * The team (admins) and each user's own account: name, passkeys and linked
 * GitHub account.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passkeys: PasskeysService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  async list() {
    const users = await this.prisma.user.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: { identities: true, _count: { select: { passkeys: true, environments: { where: { deletedAt: null } } } } },
    });
    return users.map((user) => ({
      ...presentUser(user),
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      passkeys: user._count.passkeys,
      environments: user._count.environments,
      github: user.identities.find((identity) => identity.provider === "github")?.username ?? null,
    }));
  }

  /**
   * Changes a user's role or deactivates them. A deactivated user loses
   * their sessions, tokens, preview access, terminals and log streams at
   * once, and a demoted one what the new role does not allow. The last
   * active admin cannot be demoted or deactivated.
   */
  async update(actor: Actor, id: number, body: { role?: unknown; isActive?: unknown }) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException("user not found");
    }
    const data: { role?: string; isActive?: boolean } = {};
    if (body.role !== undefined) {
      if (!isRole(body.role)) {
        throw new BadRequestException('role must be "admin" or "member"');
      }
      data.role = body.role;
    }
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") {
        throw new BadRequestException("isActive must be true or false");
      }
      data.isActive = body.isActive;
    }
    const losesAdmin = user.role === "admin" && user.isActive && (data.role === "member" || data.isActive === false);
    if (losesAdmin && (await this.prisma.user.count({ where: { role: "admin", isActive: true } })) <= 1) {
      throw new ConflictException("Spawner needs at least one active admin");
    }
    const updated = await this.prisma.user.update({ where: { id }, data });
    await this.audit.record(actor, "user.update", { target: user.name, details: { userId: id, ...data } });
    await this.access.changed(id);
    return { ...presentUser(updated), isActive: updated.isActive };
  }

  /** The logged-in user's account page. */
  async me(actor: Actor) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: this.userId(actor) },
      include: { passkeys: { orderBy: { createdAt: "asc" } }, identities: true },
    });
    return {
      user: presentUser(user),
      passkeys: user.passkeys.map((passkey) => ({
        id: passkey.id,
        name: passkey.name,
        deviceType: passkey.deviceType,
        backedUp: passkey.backedUp,
        createdAt: passkey.createdAt,
        lastUsedAt: passkey.lastUsedAt,
      })),
      identities: user.identities.map((identity) => ({ id: identity.id, provider: identity.provider, username: identity.username })),
      githubAvailable: (await this.settings.github()) !== null,
    };
  }

  /**
   * Renames the user, from a dashboard session only: the name shows in the
   * audit trail and on environments, and a token is not the person.
   */
  async rename(actor: Actor, name: unknown) {
    const value = typeof name === "string" ? name.trim() : "";
    if (value.length === 0 || value.length > 60) {
      throw new BadRequestException("name must be 1 to 60 characters");
    }
    return presentUser(await this.prisma.user.update({ where: { id: this.sessionUserId(actor) }, data: { name: value } }));
  }

  async passkeyOptions(request: Request, actor: Actor) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: this.sessionUserId(actor) }, include: { passkeys: true } });
    return this.passkeys.registrationOptions(request, { name: user.name, userHandle: user.webauthnId ?? randomToken(16), passkeys: user.passkeys }, "account");
  }

  async addPasskey(request: Request, actor: Actor, body: { credential?: unknown; name?: unknown }) {
    const userId = this.sessionUserId(actor);
    const passkey = await this.passkeys.verifyRegistration(request, body.credential, "account");
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : "Passkey";
    const stored = await this.passkeys.save(userId, passkey, name);
    await this.audit.record(actor, "passkey.add", { target: name });
    return { id: stored.id, name: stored.name, createdAt: stored.createdAt };
  }

  /**
   * Removes a passkey or unlinks GitHub, as long as another way to log in
   * remains.
   */
  async removeLogin(actor: Actor, kind: "passkey" | "identity", id: string): Promise<void> {
    const userId = this.sessionUserId(actor);
    const [passkeys, identities] = await Promise.all([
      this.prisma.passkey.findMany({ where: { userId } }),
      this.prisma.identity.findMany({ where: { userId } }),
    ]);
    const owned = kind === "passkey" ? passkeys.some((passkey) => passkey.id === id) : identities.some((identity) => identity.id === id);
    if (!owned) {
      throw new NotFoundException(kind === "passkey" ? "passkey not found" : "linked account not found");
    }
    if (passkeys.length + identities.length <= 1) {
      throw new ConflictException("keep at least one way to log in");
    }
    if (kind === "passkey") {
      await this.prisma.passkey.delete({ where: { id } });
    } else {
      await this.prisma.identity.delete({ where: { id } });
    }
    await this.audit.record(actor, kind === "passkey" ? "passkey.remove" : "identity.remove", { details: { id } });
  }

  private userId(actor: Actor): number {
    if (!actor.user) {
      throw new ForbiddenException("this needs a user, not the bootstrap token");
    }
    return actor.user.id;
  }

  private sessionUserId(actor: Actor): number {
    if (actor.via !== "session") {
      throw new ForbiddenException("manage your logins from the dashboard");
    }
    return this.userId(actor);
  }
}
