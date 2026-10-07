import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import type { Actor } from "../../common/actor";
import { CurrentActor, Public, Scopes } from "../../common/auth.guard";
import { InvitesService, type InviteRequest } from "./invites.service";
import { UsersService } from "./users.service";

@Controller("v1/invites")
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  /**
   * Creates an invitation; with userId, a link that gives a new passkey to
   * an existing user. Answers the link once.
   */
  @Post()
  @Scopes("admin")
  create(@CurrentActor() actor: Actor, @Body() body: InviteRequest) {
    return this.invites.create(actor, body ?? {});
  }

  @Get()
  @Scopes("admin")
  list() {
    return this.invites.list();
  }

  @Delete(":id")
  @Scopes("admin")
  @HttpCode(204)
  revoke(@CurrentActor() actor: Actor, @Param("id") id: string) {
    return this.invites.revoke(actor, id);
  }

  @Public()
  @Get("open/:token")
  describe(@Param("token") token: string) {
    return this.invites.describe(token);
  }

  @Public()
  @Throttle({ short: { limit: 10, ttl: 60_000 } })
  @Post("open/:token/passkey-options")
  passkeyOptions(@Req() request: Request, @Param("token") token: string, @Body() body: { name?: unknown }) {
    return this.invites.passkeyOptions(request, token, body?.name);
  }

  @Public()
  @Throttle({ short: { limit: 10, ttl: 60_000 } })
  @Post("open/:token/accept")
  accept(@Req() request: Request, @Param("token") token: string, @Body() body: { name?: unknown; credential?: unknown; passkeyName?: unknown }) {
    return this.invites.accept(request, token, body ?? {});
  }
}

@Controller("v1/users")
@Scopes("admin")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Patch(":id")
  update(@CurrentActor() actor: Actor, @Param("id", ParseIntPipe) id: number, @Body() body: { role?: unknown; isActive?: unknown }) {
    return this.users.update(actor, id, body ?? {});
  }
}

/**
 * The logged-in user's own account.
 */
@Controller("v1/me")
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  me(@CurrentActor() actor: Actor) {
    return this.users.me(actor);
  }

  @Patch()
  rename(@CurrentActor() actor: Actor, @Body() body: { name?: unknown }) {
    return this.users.rename(actor, body?.name);
  }

  @Post("passkeys/options")
  passkeyOptions(@Req() request: Request, @CurrentActor() actor: Actor) {
    return this.users.passkeyOptions(request, actor);
  }

  @Post("passkeys")
  addPasskey(@Req() request: Request, @CurrentActor() actor: Actor, @Body() body: { credential?: unknown; name?: unknown }) {
    return this.users.addPasskey(request, actor, body ?? {});
  }

  @Delete("passkeys/:id")
  @HttpCode(204)
  removePasskey(@CurrentActor() actor: Actor, @Param("id") id: string) {
    return this.users.removeLogin(actor, "passkey", id);
  }

  @Delete("identities/:id")
  @HttpCode(204)
  removeIdentity(@CurrentActor() actor: Actor, @Param("id") id: string) {
    return this.users.removeLogin(actor, "identity", id);
  }
}
