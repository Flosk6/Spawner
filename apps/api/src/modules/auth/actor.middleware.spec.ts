import { ForbiddenException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { sessionActor, type Actor } from "../../common/actor";
import { AuthGuard, Public, Scopes } from "../../common/auth.guard";
import type { PrismaService } from "../../common/prisma.service";
import type { SpawnerConfig } from "../../common/spawner.config";
import type { TokensService } from "../tokens/tokens.service";
import { ActorMiddleware } from "./actor.middleware";

const BOOTSTRAP = "a-long-bootstrap-token";
const TOKEN_ACTOR: Actor = { user: { id: 2, name: "Bob", role: "member" }, via: "token", scopes: ["envs:read"], tokenId: "t1", tokenName: "laptop", projectId: null };

function middleware(users: Record<number, { id: number; name: string; role: string; isActive: boolean }> = {}) {
  const tokens = { authenticate: async (raw: string) => (raw === "spn_valid" ? TOKEN_ACTOR : null) } as unknown as TokensService;
  const prisma = { user: { findUnique: async ({ where }: { where: { id: number } }) => users[where.id] ?? null } } as unknown as PrismaService;
  return new ActorMiddleware(tokens, prisma, { bootstrapToken: BOOTSTRAP } as SpawnerConfig);
}

async function run(subject: ActorMiddleware, request: { method: string; headers?: Record<string, string>; session?: { userId?: number } }) {
  const http = { method: request.method, headers: request.headers ?? {}, session: request.session ?? {} } as unknown as Request;
  await subject.use(http, {} as Response, () => undefined);
  return http.actor;
}

describe("ActorMiddleware", () => {
  it("refuses changes that carry neither the client header nor a bearer token", async () => {
    await expect(run(middleware(), { method: "POST" })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run(middleware(), { method: "DELETE", session: { userId: 1 } })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run(middleware(), { method: "GET" })).resolves.toBeUndefined();
  });

  it("knows the dashboard user from the session, while the account is active", async () => {
    const users = { 1: { id: 1, name: "Ada", role: "admin", isActive: true }, 3: { id: 3, name: "Old", role: "member", isActive: false } };

    expect(await run(middleware(users), { method: "POST", headers: { "x-spawner-client": "web" }, session: { userId: 1 } })).toEqual(
      sessionActor({ id: 1, name: "Ada", role: "admin" }),
    );
    expect(await run(middleware(users), { method: "GET", session: { userId: 3 } })).toBeUndefined();
  });

  it("knows token holders, the bootstrap token, and refuses bad tokens outright", async () => {
    expect(await run(middleware(), { method: "POST", headers: { authorization: "Bearer spn_valid" } })).toBe(TOKEN_ACTOR);
    expect(await run(middleware(), { method: "GET", headers: { authorization: `Bearer ${BOOTSTRAP}` } })).toMatchObject({ via: "bootstrap", user: null });
    await expect(run(middleware(), { method: "GET", headers: { authorization: "Bearer spn_revoked" } })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(run(middleware(), { method: "GET", headers: { authorization: `Bearer ${BOOTSTRAP}x` } })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

class Routes {
  @Public()
  open() {}

  closed() {}

  @Scopes("admin")
  admin() {}
}

@Scopes("envs:read")
class ReadRoutes {
  @Scopes("envs:exec")
  exec() {}
}

describe("AuthGuard", () => {
  const guard = new AuthGuard(new Reflector());
  const context = (target: object, handler: string, actor?: Actor) =>
    ({
      getType: () => "http",
      getClass: () => target.constructor,
      getHandler: () => (target as Record<string, unknown>)[handler],
      switchToHttp: () => ({ getRequest: () => ({ actor }) }),
    }) as unknown as ExecutionContext;
  const member = sessionActor({ id: 2, name: "Bob", role: "member" });

  it("lets public routes through and asks for authentication elsewhere", () => {
    expect(guard.canActivate(context(new Routes(), "open"))).toBe(true);
    expect(() => guard.canActivate(context(new Routes(), "closed"))).toThrow(UnauthorizedException);
    expect(guard.canActivate(context(new Routes(), "closed", member))).toBe(true);
  });

  it("requires the scopes of the handler and of its controller", () => {
    expect(() => guard.canActivate(context(new Routes(), "admin", member))).toThrow(ForbiddenException);
    expect(guard.canActivate(context(new ReadRoutes(), "exec", member))).toBe(true);
    expect(() => guard.canActivate(context(new ReadRoutes(), "exec", { ...TOKEN_ACTOR, scopes: ["envs:exec"] }))).toThrow(ForbiddenException);
  });
});
