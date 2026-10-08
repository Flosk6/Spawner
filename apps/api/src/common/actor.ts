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
  if (!hasScope(actor, scope)) {
    throw new ForbiddenException(`this needs the ${scope} scope`);
  }
  if (!hasScope(actor, "admin") && resource.ownerId !== actor.user?.id) {
    throw new ForbiddenException("only the owner of the environment or an admin can do this");
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
