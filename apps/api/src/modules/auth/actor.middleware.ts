import { ForbiddenException, Injectable, NestMiddleware, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { bootstrapActor, isRole, sessionActor, type Actor } from "../../common/actor";
import { PrismaService } from "../../common/prisma.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { TokensService } from "../tokens/tokens.service";

/**
 * Header every request that changes something must carry unless it uses a
 * bearer token. A page on another origin, such as a preview on the same site
 * as the dashboard, cannot add it without a CORS preflight, which only the
 * dashboard origin passes: cookies alone can never act.
 */
export const CLIENT_HEADER = "x-spawner-client";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Finds out who makes each API request: a bearer token (personal token or
 * the bootstrap token) or the dashboard session. Sets request.actor; the
 * global AuthGuard then decides what the route needs.
 */
@Injectable()
export class ActorMiddleware implements NestMiddleware {
  constructor(
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
    private readonly config: SpawnerConfig,
  ) {}

  async use(request: Request, _response: Response, next: NextFunction): Promise<void> {
    const authorization = request.headers.authorization;
    const bearer = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : null;

    if (UNSAFE_METHODS.has(request.method) && !bearer && !request.headers[CLIENT_HEADER]) {
      throw new ForbiddenException(`requests that change something need the X-Spawner-Client header or a bearer token`);
    }

    if (bearer) {
      const actor = this.isBootstrapToken(bearer) ? bootstrapActor() : await this.tokens.authenticate(bearer);
      if (!actor) {
        throw new UnauthorizedException("invalid, expired or revoked token");
      }
      request.actor = actor;
    } else if (request.session?.userId) {
      request.actor = (await this.sessionActor(request.session.userId)) ?? undefined;
    }
    next();
  }

  private async sessionActor(userId: number): Promise<Actor | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return user?.isActive && isRole(user.role) ? sessionActor({ id: user.id, name: user.name, role: user.role }) : null;
  }

  private isBootstrapToken(given: string): boolean {
    const expected = this.config.bootstrapToken;
    if (!expected) {
      return false;
    }
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
