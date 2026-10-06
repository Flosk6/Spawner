import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import type { Actor } from "../../common/actor";
import { CurrentActor, Public, Scopes } from "../../common/auth.guard";
import { PrismaService } from "../../common/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { DeviceService } from "./device.service";
import { GithubLoginService } from "./github-login.service";
import { PasskeysService } from "./passkeys.service";
import { presentUser, safeNext } from "./present";
import { SessionsService } from "./sessions.service";
import { WsTicketsService } from "./ws-tickets.service";

@Controller("v1/auth")
export class AuthController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly passkeys: PasskeysService,
    private readonly github: GithubLoginService,
    private readonly settings: SettingsService,
    private readonly tickets: WsTicketsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Who is logged in, and the login methods available.
   */
  @Public()
  @Get("session")
  async session(@Req() request: Request) {
    const user = request.actor?.via === "session" && request.actor.user ? await this.prisma.user.findUnique({ where: { id: request.actor.user.id } }) : null;
    return { user: user ? presentUser(user) : null, methods: { passkey: true, github: (await this.settings.github()) !== null } };
  }

  @Post("logout")
  @HttpCode(204)
  logout(@Req() request: Request) {
    return this.sessions.logout(request);
  }

  @Public()
  @Throttle({ short: { limit: 10, ttl: 60_000 } })
  @Post("passkey/options")
  passkeyOptions(@Req() request: Request) {
    return this.passkeys.loginOptions(request);
  }

  @Public()
  @Throttle({ short: { limit: 10, ttl: 60_000 } })
  @Post("passkey")
  async passkeyLogin(@Req() request: Request, @Body() body: { credential?: unknown }) {
    const user = await this.passkeys.verifyLogin(request, body?.credential);
    await this.sessions.login(request, user, "passkey");
    return { user: presentUser(user) };
  }

  /**
   * Sends the browser to GitHub. With link=true, the GitHub account is linked
   * to the logged-in user instead.
   */
  @Public()
  @Get("github")
  async githubStart(@Req() request: Request, @Res() response: Response, @Query("next") next?: string, @Query("link") link?: string) {
    try {
      response.redirect(await this.github.start(request, safeNext(next), link === "true" && Boolean(request.actor?.user)));
    } catch (error) {
      response.redirect(`/login?error=${encodeURIComponent((error as Error).message)}`);
    }
  }

  @Public()
  @Get("github/callback")
  async githubCallback(@Req() request: Request, @Res() response: Response, @Query("code") code?: string, @Query("state") state?: string) {
    try {
      const result = await this.github.finish(request, code, state, request.actor?.via === "session" ? (request.actor.user?.id ?? null) : null);
      if (!result.linked) {
        await this.sessions.login(request, result.user, "github");
      }
      response.redirect(result.next ?? (result.linked ? "/account" : "/"));
    } catch (error) {
      response.redirect(`/login?error=${encodeURIComponent((error as Error).message)}`);
    }
  }

  /**
   * A one-time ticket to open a terminal over the WebSocket.
   */
  @Post("ws-ticket")
  @Scopes("envs:exec")
  wsTicket(@CurrentActor() actor: Actor) {
    return this.tickets.issue(actor.user?.id ?? 0);
  }
}

/**
 * Login of the CLI by device code (RFC 8628).
 */
@Controller("v1/auth/device")
export class DeviceController {
  constructor(private readonly device: DeviceService) {}

  @Public()
  @Throttle({ short: { limit: 10, ttl: 60_000 } })
  @Post()
  start(@Body() body: { clientName?: unknown }) {
    return this.device.start(body?.clientName);
  }

  @Public()
  @Throttle({ short: { limit: 30, ttl: 60_000 } })
  @Post("token")
  token(@Body() body: { deviceCode?: unknown }) {
    return this.device.poll(body?.deviceCode);
  }

  @Get(":userCode")
  describe(@CurrentActor() actor: Actor, @Req() request: Request) {
    return this.device.describe(actor, request.params.userCode);
  }

  @Post("approve")
  approve(@CurrentActor() actor: Actor, @Body() body: { userCode?: unknown; approve?: unknown }) {
    return this.device.decide(actor, body?.userCode, body?.approve === true);
  }
}

/**
 * The GitHub callback of Spawner before v1, still registered in existing
 * OAuth apps: forwards to the v1 route with the same code and state.
 */
@Controller("auth")
export class LegacyGithubCallbackController {
  @Public()
  @Get("github/callback")
  forward(@Req() request: Request, @Res() response: Response) {
    const query = request.originalUrl.includes("?") ? request.originalUrl.slice(request.originalUrl.indexOf("?")) : "";
    response.redirect(302, `/api/v1/auth/github/callback${query}`);
  }
}

