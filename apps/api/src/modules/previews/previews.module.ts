import { Body, Controller, Delete, Get, HttpCode, Module, NotFoundException, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { assertInProject, type Actor } from "../../common/actor";
import { CurrentActor, Public, Scopes } from "../../common/auth.guard";
import { NoThrottle } from "../../common/throttler.guard";
import { PrismaService } from "../../common/prisma.service";
import { EngineModule } from "../engine/engine.module";
import { ActivityService } from "../lifecycle/activity.service";
import { SupervisionModule } from "../supervision/supervision.module";
import { PREVIEW_HEADER, PreviewsService, applicationCookies, parseCookies } from "./previews.service";
import { SharesService } from "./shares.service";
import { WakeController } from "./wake.controller";

const header = (request: Request, name: string) => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

@Controller("v1/auth")
export class PreviewAuthController {
  constructor(private readonly previews: PreviewsService) {}

  /**
   * forwardAuth of Traefik, before every request to a protected preview.
   * Answers 200 to let the request through, with the request's cookies
   * without Spawner's own, which the routes of the applications pass on
   * instead of the original ones (no Cookie header: none left). Any other
   * answer goes back to the browser as is (a redirect with its cookie, or a
   * 401).
   */
  @Public()
  @NoThrottle()
  @Get("verify")
  async verify(@Req() request: Request, @Res() response: Response) {
    const decision = await this.previews.decide({
      method: header(request, "x-forwarded-method") ?? "GET",
      proto: header(request, "x-forwarded-proto") ?? "http",
      host: header(request, "x-forwarded-host") ?? "",
      uri: header(request, "x-forwarded-uri") ?? "/",
      accept: header(request, "accept") ?? "",
      cookies: parseCookies(header(request, "cookie")),
      header: header(request, PREVIEW_HEADER),
      origin: header(request, "origin"),
      preflightMethod: header(request, "access-control-request-method"),
    });
    response.setHeader("Cache-Control", "no-store");
    if (decision.status === 302) {
      if (decision.cookie) {
        response.setHeader("Set-Cookie", decision.cookie);
      }
      response.redirect(302, decision.location);
    } else if (decision.status === 200) {
      const cookies = applicationCookies(header(request, "cookie"));
      if (cookies) {
        response.setHeader("Cookie", cookies);
      }
      response.status(200).end();
    } else {
      response.status(decision.status).json(decision.body);
    }
  }

  /**
   * forwardAuth of Traefik before every request to a public preview: lets
   * it through, with its cookies without Spawner's own, so that a public
   * application does not see what opens the other previews either.
   */
  @Public()
  @NoThrottle()
  @Get("verify-public")
  verifyPublic(@Req() request: Request, @Res() response: Response) {
    const cookies = applicationCookies(header(request, "cookie"));
    if (cookies) {
      response.setHeader("Cookie", cookies);
    }
    response.setHeader("Cache-Control", "no-store");
    response.status(200).end();
  }

  /**
   * Where a browser lands when it has no preview cookie: a logged-in user
   * gets the cookie and goes back to the preview; anyone else logs in first.
   */
  @Public()
  @Get("preview")
  preview(@Req() request: Request, @Res() response: Response, @Query("next") next?: string) {
    const target = this.previews.previewUrl(next);
    if (request.actor?.via !== "session") {
      const back = `/api/v1/auth/preview?next=${encodeURIComponent(target)}`;
      response.redirect(302, `/login?next=${encodeURIComponent(back)}`);
      return;
    }
    const { cookie } = this.previews.previewCookie(request.actor, target);
    response.setHeader("Set-Cookie", cookie);
    response.redirect(302, target);
  }
}

@Controller("v1/envs/:id")
export class PreviewAccessController {
  constructor(
    private readonly previews: PreviewsService,
    private readonly shares: SharesService,
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  /**
   * A token for the X-Spawner-Preview header, valid one hour on this
   * environment: how agents and scripts call a protected preview.
   */
  @Post("preview-token")
  @Scopes("preview")
  async previewToken(@CurrentActor() actor: Actor, @Param("id") id: string) {
    const environment = await this.prisma.environment.findFirst({ where: { id, deletedAt: null } });
    if (!environment) {
      throw new NotFoundException(`environment "${id}" not found`);
    }
    assertInProject(actor, environment.projectId);
    this.activity.touch(environment.id);
    return this.previews.headerToken(actor, environment.id);
  }

  @Post("share")
  share(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: { ttlHours?: unknown }) {
    return this.shares.create(actor, id, body?.ttlHours);
  }

  @Get("shares")
  @Scopes("envs:read")
  listShares(@CurrentActor() actor: Actor, @Param("id") id: string) {
    return this.shares.list(actor, id);
  }

  @Delete("shares/:shareId")
  @HttpCode(204)
  revokeShare(@CurrentActor() actor: Actor, @Param("id") id: string, @Param("shareId") shareId: string) {
    return this.shares.revoke(actor, id, shareId);
  }
}

@Module({
  imports: [EngineModule, SupervisionModule],
  controllers: [PreviewAuthController, PreviewAccessController, WakeController],
  providers: [PreviewsService, SharesService],
})
export class PreviewsModule {}
