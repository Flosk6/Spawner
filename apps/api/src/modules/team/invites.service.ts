import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Invite, User } from "@prisma/client";
import type { Request } from "express";
import { isRole, type Actor, type Role } from "../../common/actor";
import { PrismaService } from "../../common/prisma.service";
import { randomToken, sha256 } from "../../common/secrets.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { AuditService } from "../audit/audit.service";
import { PasskeysService } from "../auth/passkeys.service";
import { SessionsService } from "../auth/sessions.service";

export const INVITE_DEFAULT_HOURS = 24;
const INVITE_MAX_HOURS = 7 * 24;

export interface InviteRequest {
  role?: unknown;
  note?: unknown;
  userId?: unknown;
  ttlHours?: unknown;
}

/**
 * Invitations: one-time links, valid 24 hours by default, the only way in
 * without GitHub. Opening one registers a passkey and creates the account;
 * an invitation for an existing user (userId) gives back access to someone
 * who lost their passkeys.
 */
@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passkeys: PasskeysService,
    private readonly sessions: SessionsService,
    private readonly config: SpawnerConfig,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates an invitation and returns its link, shown once.
   *
   * @param actor - Admin who invites, or null when Spawner invites its first admin
   */
  async create(actor: Actor | null, request: InviteRequest) {
    const hours = request.ttlHours === undefined ? INVITE_DEFAULT_HOURS : Number(request.ttlHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > INVITE_MAX_HOURS) {
      throw new BadRequestException(`ttlHours must be a whole number of hours between 1 and ${INVITE_MAX_HOURS}`);
    }
    if (request.note !== undefined && (typeof request.note !== "string" || request.note.length > 100)) {
      throw new BadRequestException("note must be text, 100 characters at most");
    }
    let role: Role;
    let user: User | null = null;
    if (request.userId !== undefined) {
      user = await this.prisma.user.findUnique({ where: { id: Number(request.userId) } });
      if (!user) {
        throw new NotFoundException("user not found");
      }
      role = user.role as Role;
    } else if (isRole(request.role ?? "member")) {
      role = (request.role ?? "member") as Role;
    } else {
      throw new BadRequestException('role must be "admin" or "member"');
    }

    const token = randomToken(32);
    const invite = await this.prisma.invite.create({
      data: {
        tokenHash: sha256(token),
        role,
        note: (request.note as string | undefined)?.trim() || (user ? `new passkey for ${user.name}` : null),
        userId: user?.id ?? null,
        createdById: actor?.user?.id ?? null,
        expiresAt: new Date(Date.now() + hours * 3_600_000),
      },
    });
    await this.audit.record(actor, user ? "invite.recovery" : "invite.create", { target: invite.note ?? role, details: { inviteId: invite.id, role, hours } });
    return { id: invite.id, url: `${this.config.dashboardUrl}/invite/${token}`, role, note: invite.note, expiresAt: invite.expiresAt };
  }

  /** Invitations still waiting to be used. */
  async list() {
    const invites = await this.prisma.invite.findMany({
      where: { usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { createdBy: true, user: true },
      orderBy: { createdAt: "desc" },
    });
    return invites.map((invite) => ({
      id: invite.id,
      role: invite.role,
      note: invite.note,
      user: invite.user ? { id: invite.user.id, name: invite.user.name } : null,
      createdBy: invite.createdBy?.name ?? null,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
    }));
  }

  async revoke(actor: Actor, id: string): Promise<void> {
    const { count } = await this.prisma.invite.updateMany({ where: { id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (count === 0) {
      throw new NotFoundException("invitation not found or already used");
    }
    await this.audit.record(actor, "invite.revoke", { details: { inviteId: id } });
  }

  /** What the invitation page shows before the passkey is created. */
  async describe(token: string) {
    const invite = await this.valid(token);
    return {
      role: invite.role,
      note: invite.note,
      user: invite.user ? { name: invite.user.name } : null,
      expiresAt: invite.expiresAt,
      passkeyRequired: this.passkeyRequired,
    };
  }

  /**
   * Options to create the passkey of the invitation. A new user picks a
   * name; an existing user keeps theirs and their user handle.
   */
  async passkeyOptions(request: Request, token: string, name: unknown) {
    const invite = await this.valid(token);
    if (invite.user) {
      const passkeys = await this.prisma.passkey.findMany({ where: { userId: invite.user.id } });
      return this.passkeys.registrationOptions(
        request,
        { name: invite.user.name, userHandle: invite.user.webauthnId ?? randomToken(16), passkeys },
        `invite:${invite.id}`,
      );
    }
    return this.passkeys.registrationOptions(request, { name: this.name(name), userHandle: randomToken(16), passkeys: [] }, `invite:${invite.id}`);
  }

  /**
   * Uses the invitation: stores the passkey, creates the account (or
   * reopens the existing one) and logs the user in. Without TLS, where
   * browsers refuse passkeys on any host but localhost, the invitation logs in
   * without a passkey.
   */
  async accept(request: Request, token: string, body: { name?: unknown; credential?: unknown; passkeyName?: unknown }) {
    const invite = await this.valid(token);
    const passkey = body.credential ? await this.passkeys.verifyRegistration(request, body.credential, `invite:${invite.id}`) : null;
    if (!passkey && this.passkeyRequired) {
      throw new BadRequestException("create a passkey to accept the invitation");
    }
    const name = invite.user ? invite.user.name : this.name(body.name);

    const user = await this.prisma.$transaction(async (db) => {
      const claimed = await db.invite.updateMany({ where: { id: invite.id, usedAt: null, revokedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) {
        throw new ConflictException("this invitation was just used");
      }
      const account = invite.user ?? (await db.user.create({ data: { name, role: invite.role } }));
      if (passkey) {
        await this.passkeys.save(account.id, passkey, this.passkeyName(body.passkeyName), db);
      }
      return account;
    });
    await this.audit.record(null, invite.user ? "invite.recovered" : "invite.accept", {
      userId: user.id,
      actorName: user.name,
      details: { inviteId: invite.id, role: user.role, passkey: Boolean(passkey) },
      request,
    });
    await this.sessions.login(request, user, "invite");
    return { user: { id: user.id, name: user.name, role: user.role } };
  }

  /** Passkeys are required wherever browsers support them. */
  get passkeyRequired(): boolean {
    return this.config.tls !== "off";
  }

  private async valid(token: string): Promise<Invite & { user: User | null }> {
    const invite = await this.prisma.invite.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!invite || invite.usedAt || invite.revokedAt || invite.expiresAt <= new Date() || (invite.user && !invite.user.isActive)) {
      throw new NotFoundException("this invitation is invalid, expired or already used: ask an admin for a new one");
    }
    return invite;
  }

  private name(value: unknown): string {
    const name = typeof value === "string" ? value.trim() : "";
    if (name.length === 0 || name.length > 60) {
      throw new BadRequestException("enter your name, 60 characters at most");
    }
    return name;
  }

  private passkeyName(value: unknown): string {
    return typeof value === "string" && value.trim() ? value.trim().slice(0, 60) : "Passkey";
  }
}
