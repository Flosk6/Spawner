import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "crypto";
import { SpawnerConfig } from "../modules/engine/spawner.config";

/**
 * Who made an API request: a user logged in to the dashboard, or a client
 * using the bootstrap token.
 */
export interface ApiActor {
  userId: number | null;
  via: "session" | "token";
}

/**
 * Header the web interface adds to the requests that change something. A page
 * on another origin, such as a preview, cannot add it without a CORS
 * preflight, which only the dashboard origin passes: a session cookie alone
 * is not enough to act.
 */
export const CLIENT_HEADER = "x-spawner-client";

const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

/**
 * Guard of the /api/v1 routes. Accepts a dashboard session, or the
 * SPAWNER_BOOTSTRAP_TOKEN as a Bearer token for scripts, CI and the CLI until
 * personal tokens arrive (milestone M2).
 */
@Injectable()
export class ApiAuthGuard implements CanActivate {
  constructor(private readonly config: SpawnerConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    if (typeof request.isAuthenticated === "function" && request.isAuthenticated()) {
      if (!SAFE_METHODS.includes(request.method) && !request.headers?.[CLIENT_HEADER]) {
        throw new ForbiddenException(`browser requests must carry the ${CLIENT_HEADER} header`);
      }
      request.actor = { userId: request.user?.id ?? null, via: "session" } satisfies ApiActor;
      return true;
    }

    const header: unknown = request.headers?.authorization;
    const expected = this.config.bootstrapToken;
    if (expected && typeof header === "string" && header.startsWith("Bearer ")) {
      const given = Buffer.from(header.slice("Bearer ".length));
      const wanted = Buffer.from(expected);
      if (given.length === wanted.length && timingSafeEqual(given, wanted)) {
        request.actor = { userId: null, via: "token" } satisfies ApiActor;
        return true;
      }
    }

    throw new UnauthorizedException("authentication required");
  }
}
