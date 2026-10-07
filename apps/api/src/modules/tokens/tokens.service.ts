import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { ApiToken, Project, User } from "@prisma/client";
import { randomBytes, timingSafeEqual } from "crypto";
import { ROLE_SCOPES, SCOPES, hasScope, isRole, type Actor, type Scope } from "../../common/actor";
import { PrismaService } from "../../common/prisma.service";
import { randomToken, sha256 } from "../../common/secrets.service";
import { AuditService } from "../audit/audit.service";

const TOKEN_PATTERN = /^spn_([a-z0-9]{8})_([A-Za-z0-9_-]{43})$/;
const PREFIX_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const LAST_USED_RESOLUTION_MS = 60_000;

export const DEFAULT_TOKEN_SCOPES: readonly Scope[] = ["envs:read", "envs:write", "envs:exec", "preview"];
export const DEFAULT_TOKEN_DAYS = 90;
export const MAX_TOKEN_DAYS = 365;

export interface TokenRequest {
  name?: unknown;
  scopes?: unknown;
  expiresInDays?: unknown;
  project?: unknown;
}

/**
 * Personal API tokens: `spn_<prefix>_<secret>`, shown once. The prefix finds
 * the token, only the SHA-256 of the whole token is stored, and a token never
 * holds more than its user's role allows, even after the role changes.
 */
@Injectable()
export class TokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates a token for the actor's user, with at most the actor's own
   * scopes and project.
   *
   * @returns The token, to show once, and its description
   */
  async create(actor: Actor, request: TokenRequest) {
    if (!actor.user) {
      throw new BadRequestException("tokens belong to a user; log in to create one");
    }
    const name = this.name(request.name);
    const scopes = this.scopes(request.scopes);
    const missing = scopes.filter((scope) => !hasScope(actor, scope));
    if (missing.length > 0) {
      throw new ForbiddenException(`you cannot give scopes you do not have: ${missing.join(", ")}`);
    }
    const projectId = await this.projectId(actor, request.project);
    const days = this.days(request.expiresInDays);

    const issued = await this.issue(actor.user.id, { name, scopes, projectId, days });
    await this.audit.record(actor, "token.create", { target: name, details: { scopes, days, projectId } });
    return issued;
  }

  /**
   * Issues a token without an actor, for the device flow once the user
   * approved the login.
   */
  async issue(userId: number, options: { name: string; scopes: readonly Scope[]; projectId?: string | null; days?: number | null }) {
    const prefix = await this.freePrefix();
    const token = `spn_${prefix}_${randomToken(32)}`;
    const record = await this.prisma.apiToken.create({
      data: {
        userId,
        name: options.name,
        prefix,
        hash: sha256(token),
        scopes: [...options.scopes],
        projectId: options.projectId ?? null,
        expiresAt: options.days === null ? null : new Date(Date.now() + (options.days ?? DEFAULT_TOKEN_DAYS) * 86_400_000),
      },
      include: { project: true },
    });
    return { token, info: this.present(record) };
  }

  /**
   * Turns a bearer token into an actor, or null when it is unknown, revoked,
   * expired or belongs to a deactivated user.
   */
  async authenticate(raw: string): Promise<Actor | null> {
    const match = TOKEN_PATTERN.exec(raw);
    if (!match) {
      return null;
    }
    const record = await this.prisma.apiToken.findUnique({ where: { prefix: match[1] }, include: { user: true } });
    if (!record || !sameHash(record.hash, sha256(raw))) {
      return null;
    }
    if (record.revokedAt || (record.expiresAt && record.expiresAt <= new Date()) || !record.user.isActive || !isRole(record.user.role)) {
      return null;
    }
    if (!record.lastUsedAt || Date.now() - record.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
      void this.prisma.apiToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    const allowed = ROLE_SCOPES[record.user.role];
    return {
      user: { id: record.user.id, name: record.user.name, role: record.user.role },
      via: "token",
      scopes: record.scopes.filter((scope): scope is Scope => (allowed as readonly string[]).includes(scope)),
      tokenId: record.id,
      tokenName: record.name,
      projectId: record.projectId,
    };
  }

  /**
   * The actor's tokens, or everyone's for an admin who asks.
   */
  async list(actor: Actor, everyone: boolean) {
    const where = everyone && hasScope(actor, "admin") ? {} : { userId: actor.user?.id ?? -1 };
    const records = await this.prisma.apiToken.findMany({
      where: { ...where, revokedAt: null },
      include: { project: true, user: true },
      orderBy: { createdAt: "desc" },
    });
    return records.map((record) => ({ ...this.present(record), user: { id: record.user.id, name: record.user.name } }));
  }

  async revoke(actor: Actor, id: string): Promise<void> {
    const record = await this.prisma.apiToken.findUnique({ where: { id } });
    if (!record || record.revokedAt || (record.userId !== actor.user?.id && !hasScope(actor, "admin"))) {
      throw new NotFoundException("token not found");
    }
    await this.prisma.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.record(actor, "token.revoke", { target: record.name, details: { tokenId: id, userId: record.userId } });
  }

  present(record: ApiToken & { project?: Project | null; user?: User }) {
    return {
      id: record.id,
      name: record.name,
      hint: `spn_${record.prefix}_...`,
      scopes: record.scopes,
      project: record.project?.slug ?? null,
      expiresAt: record.expiresAt,
      lastUsedAt: record.lastUsedAt,
      createdAt: record.createdAt,
    };
  }

  private name(value: unknown): string {
    const name = typeof value === "string" ? value.trim() : "";
    if (name.length === 0 || name.length > 40) {
      throw new BadRequestException("name the token, 40 characters at most (for example claude-laptop)");
    }
    return name;
  }

  private scopes(value: unknown): Scope[] {
    if (value === undefined) {
      return [...DEFAULT_TOKEN_SCOPES];
    }
    if (!Array.isArray(value) || value.length === 0 || !value.every((scope) => (SCOPES as readonly unknown[]).includes(scope))) {
      throw new BadRequestException(`scopes must be a non-empty list among ${SCOPES.join(", ")}`);
    }
    return [...new Set(value as Scope[])];
  }

  private days(value: unknown): number {
    if (value === undefined || value === null) {
      return DEFAULT_TOKEN_DAYS;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_TOKEN_DAYS) {
      throw new BadRequestException(`expiresInDays must be a whole number of days between 1 and ${MAX_TOKEN_DAYS}`);
    }
    return value;
  }

  private async projectId(actor: Actor, value: unknown): Promise<string | null> {
    if (value === undefined || value === null || value === "") {
      return actor.projectId;
    }
    if (typeof value !== "string") {
      throw new BadRequestException("project must be a project slug");
    }
    const project = await this.prisma.project.findUnique({ where: { slug: value } });
    if (!project) {
      throw new BadRequestException(`project "${value}" not found`);
    }
    if (actor.projectId && actor.projectId !== project.id) {
      throw new ForbiddenException("your token is restricted to another project");
    }
    return project.id;
  }

  private async freePrefix(): Promise<string> {
    for (;;) {
      const prefix = Array.from(randomBytes(8), (byte) => PREFIX_ALPHABET[byte % PREFIX_ALPHABET.length]).join("");
      if (!(await this.prisma.apiToken.findUnique({ where: { prefix } }))) {
        return prefix;
      }
    }
  }
}

function sameHash(stored: string, computed: string): boolean {
  const a = Buffer.from(stored);
  const b = Buffer.from(computed);
  return a.length === b.length && timingSafeEqual(a, b);
}
