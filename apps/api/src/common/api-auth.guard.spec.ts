import { ForbiddenException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { SpawnerConfig } from "../modules/engine/spawner.config";
import { ApiAuthGuard, CLIENT_HEADER } from "./api-auth.guard";

const TOKEN = "a-long-bootstrap-token";

function attempt(request: { method: string; headers?: Record<string, string>; session?: { userId: number } }) {
  const guard = new ApiAuthGuard({ bootstrapToken: TOKEN } as SpawnerConfig);
  const http = {
    method: request.method,
    headers: request.headers ?? {},
    user: request.session ? { id: request.session.userId } : undefined,
    isAuthenticated: () => request.session !== undefined,
  } as Record<string, unknown>;
  const context = { switchToHttp: () => ({ getRequest: () => http }) } as ExecutionContext;
  guard.canActivate(context);
  return http.actor;
}

describe("ApiAuthGuard", () => {
  it("lets a dashboard session read", () => {
    expect(attempt({ method: "GET", session: { userId: 7 } })).toEqual({ userId: 7, via: "session" });
  });

  it("lets a dashboard session act when the request comes from the interface", () => {
    expect(attempt({ method: "POST", session: { userId: 7 }, headers: { [CLIENT_HEADER]: "web" } })).toEqual({ userId: 7, via: "session" });
  });

  it("refuses an action carried by the session cookie alone, as a forged request from another page would be", () => {
    expect(() => attempt({ method: "POST", session: { userId: 7 } })).toThrow(ForbiddenException);
    expect(() => attempt({ method: "DELETE", session: { userId: 7 } })).toThrow(ForbiddenException);
  });

  it("accepts the bootstrap token", () => {
    expect(attempt({ method: "POST", headers: { authorization: `Bearer ${TOKEN}` } })).toEqual({ userId: null, via: "token" });
  });

  it.each([{}, { authorization: "Bearer wrong" }, { authorization: TOKEN }, { authorization: `Bearer ${TOKEN}x` }])("refuses %j", (headers) => {
    expect(() => attempt({ method: "GET", headers })).toThrow(UnauthorizedException);
  });
});
