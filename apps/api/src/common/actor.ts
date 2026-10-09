import { ForbiddenException } from "@nestjs/common";

/**
 * What a token or a session may do:
 * - envs:read: list environments, their logs and resources
 * - envs:write: create, update, stop, start, share and delete environments
 * - envs:exec: run commands and open terminals in environments
 * - preview: open the previews of environments
 * - admin: projects, team, settings and audit
 */
export const SCOPES = ["envs:read", "envs:write", "envs:exec", "preview", "admin"] as const;
export type Scope = (typeof SCOPES)[number];

export const ROLES = ["admin", "member"] as const;
export type Role = (typeof ROLES)[number];

/** Everything a role allows; a token holds a subset of its user's scopes. */
export const ROLE_SCOPES: Record<Role, readonly Scope[]> = {
  admin: SCOPES,
  member: ["envs:read", "envs:write", "envs:exec", "preview"],
};

export interface ActorUser {
  id: number;
  name: string;
  role: Role;
}

/**
 * Who makes a request: a user through the dashboard session or one of their
 * API tokens, or the bootstrap token of the installation (no user, every
 * scope).
 */
export interface Actor {
  user: ActorUser | null;
  via: "session" | "token" | "bootstrap";
  scopes: readonly Scope[];
  tokenId: string | null;
  tokenName: string | null;
  /** Project a token is restricted to. */
  projectId: string | null;
}

export function sessionActor(user: ActorUser): Actor {
  return { user, via: "session", scopes: ROLE_SCOPES[user.role], tokenId: null, tokenName: null, projectId: null };
}

export function bootstrapActor(): Actor {
  return { user: null, via: "bootstrap", scopes: SCOPES, tokenId: null, tokenName: "bootstrap token", projectId: null };
}

/** A personal token as stored, with its user. */
export interface TokenRecord {
  id: string;
  name: string;
  scopes: string[];
  projectId: string | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
  user: { id: number; name: string; role: string; isActive: boolean };
}

/**
 * What a token may do now: nothing once it is revoked or expired or its user
 * deactivated, and never more than its user's role allows (without admin
 * when it is restricted to a project, since admin reaches the whole
 * installation).
 *
 * @returns The actor, or null when the token no longer opens anything
 */
export function tokenActor(record: TokenRecord, now = new Date()): Actor | null {
  if (record.revokedAt || (record.expiresAt && record.expiresAt <= now) || !record.user.isActive || !isRole(record.user.role)) {
    return null;
  }
  const allowed: readonly string[] = record.projectId ? ROLE_SCOPES[record.user.role].filter((scope) => scope !== "admin") : ROLE_SCOPES[record.user.role];
  return {
    user: { id: record.user.id, name: record.user.name, role: record.user.role },
    via: "token",
    scopes: record.scopes.filter((scope): scope is Scope => allowed.includes(scope)),
    tokenId: record.id,
    tokenName: record.name,
    projectId: record.projectId,
  };
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function hasScope(actor: Actor, scope: Scope): boolean {
  return actor.scopes.includes(scope);
}

/**
 * How the audit trail and the interface name an actor: "Ada",
 * "Ada via claude-laptop", "bootstrap token".
 */
export function describeActor(actor: Actor | null): string {
  if (!actor) {
    return "system";
  }
  if (!actor.user) {
    return actor.tokenName ?? "anonymous";
  }
  return actor.via === "token" && actor.tokenName ? `${actor.user.name} via ${actor.tokenName}` : actor.user.name;
}

/**
 * Members manage their own environments; admins manage all of them. A token
 * restricted to a project reaches nothing else.
 *
 * @throws ForbiddenException with the reason
 */
export function assertCanAct(actor: Actor, scope: Scope, resource: { ownerId: number | null; projectId: string }): void {
  assertInProject(actor, resource.projectId);
  assertScope(actor, scope);
  if (!hasScope(actor, "admin") && resource.ownerId !== actor.user?.id) {
    throw new ForbiddenException("only the owner of the environment or an admin can do this");
  }
}

/**
 * @throws ForbiddenException when the actor lacks the scope
 */
export function assertScope(actor: Actor, scope: Scope): void {
  if (!hasScope(actor, scope)) {
    throw new ForbiddenException(`this needs the ${scope} scope`);
  }
}

/**
 * @throws ForbiddenException when a token restricted to another project is used
 */
export function assertInProject(actor: Actor, projectId: string): void {
  if (actor.projectId && actor.projectId !== projectId) {
    throw new ForbiddenException("this token is restricted to another project");
  }
}
