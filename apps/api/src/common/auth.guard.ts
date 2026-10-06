import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { hasScope, type Actor, type Scope } from "./actor";

const PUBLIC_KEY = "spawner:public";
const SCOPES_KEY = "spawner:scopes";

/** Lets a route through without authentication. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Requires every scope listed, on top of authentication. */
export const Scopes = (...scopes: Scope[]) => SetMetadata(SCOPES_KEY, scopes);

/** The actor of the request (set by ActorMiddleware); routes not marked Public always have one. */
export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): Actor => {
  return context.switchToHttp().getRequest<Request>().actor as Actor;
});

/**
 * Global guard: every route needs an authenticated actor unless it is marked
 * Public, and the scopes its handler or controller lists.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") {
      return true;
    }
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) {
      return true;
    }
    const actor = context.switchToHttp().getRequest<Request>().actor;
    if (!actor) {
      throw new UnauthorizedException("authentication required");
    }
    for (const scope of this.reflector.getAllAndMerge<Scope[]>(SCOPES_KEY, targets) ?? []) {
      if (!hasScope(actor, scope)) {
        throw new ForbiddenException(`this needs the ${scope} scope`);
      }
    }
    return true;
  }
}
