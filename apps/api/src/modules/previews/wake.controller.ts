import { All, Controller, Req, Res } from "@nestjs/common";
import type { Environment } from "@prisma/client";
import type { Request, Response } from "express";
import { Public } from "../../common/auth.guard";
import { LimitReachedException } from "../../common/limit-reached";
import { PrismaService } from "../../common/prisma.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { NoThrottle } from "../../common/throttler.guard";
import { JobQueueService } from "../engine/job-queue.service";
import { WAKE_HEADER } from "../engine/router.service";
import { UsageService } from "../supervision/usage.service";
import { PREVIEW_HEADER, PreviewsService, parseCookies, type PreviewDecision } from "./previews.service";
import { wakePage, type WakeState, type WakeView } from "./wake-page";

const RETRY_AFTER_SECONDS = 5;
const WAKE_PAGE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const header = (request: Request, name: string) => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Where Traefik sends the requests for a sleeping or stopped environment: its
 * routes rewrite the path to this one, and keep the original in
 * X-Replaced-Path. A team URL wakes the environment up, once the usual check
 * of who may open it passed; a public URL does not (anyone, crawlers
 * included, could keep it awake). Browsers get a page that reloads by itself
 * once the environment answers; other clients a 503 to retry.
 */
@Controller("v1")
export class WakeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly previews: PreviewsService,
    private readonly queue: JobQueueService,
    private readonly usage: UsageService,
    private readonly config: SpawnerConfig,
  ) {}

  @Public()
  @NoThrottle()
  @All("wake")
  async wake(@Req() request: Request, @Res() response: Response) {
    const host = (header(request, "x-forwarded-host") ?? header(request, "host") ?? "").replace(/:\d+$/, "");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(WAKE_HEADER, "1");
    const exposure = await this.prisma.exposure.findFirst({
      where: { host, environment: { deletedAt: null } },
      include: { environment: { include: { project: { select: { slug: true } } } } },
    });
    if (!exposure) {
      response.status(404).json({ error: "unknown_preview" });
      return;
    }

    if (exposure.auth !== "none") {
      const query = request.originalUrl.includes("?") ? request.originalUrl.slice(request.originalUrl.indexOf("?")) : "";
      const decision = await this.previews.decide({
        method: request.method,
        proto: header(request, "x-forwarded-proto") ?? this.config.scheme,
        host,
        uri: `${header(request, "x-replaced-path") ?? "/"}${query}`,
        accept: header(request, "accept") ?? "",
        cookies: parseCookies(header(request, "cookie")),
        header: header(request, PREVIEW_HEADER),
      });
      if (decision.status !== 200) {
        this.refuse(response, decision);
        return;
      }
    }

    const environment = exposure.environment;
    const view = await this.handle(environment, environment.project.slug, exposure.auth === "none", host);
    if (request.query.__spawner_wake === "status") {
      response.status(200).json({ state: view.state, message: view.message });
      return;
    }
    response.setHeader("Retry-After", String(RETRY_AFTER_SECONDS));
    const accept = header(request, "accept") ?? "";
    if (["GET", "HEAD"].includes(request.method) && accept.includes("text/html")) {
      response.setHeader("Content-Security-Policy", WAKE_PAGE_POLICY);
      response.status(503).type("html").send(wakePage(view));
      return;
    }
    response.status(503).json({ error: `environment_${view.state}`, state: view.state, message: view.message, retryAfter: RETRY_AFTER_SECONDS });
  }

  /**
   * What the environment's status calls for; a sleeping one reached by a team
   * URL gets a wake-up queued, unless the server lacks the memory for it.
   */
  private async handle(environment: Environment, project: string, isPublic: boolean, host: string): Promise<WakeView> {
    const view = (state: WakeState, message: string): WakeView => ({
      state,
      message,
      environment: environment.slug,
      project,
      dashboardUrl: `${this.config.dashboardUrl}/environments/${environment.id}`,
    });
    switch (environment.status) {
      case "sleeping": {
        if (isPublic) {
          return view("asleep", "It went to sleep after a while without visits, and its public URLs do not wake it up. Someone of the team can wake it up from Spawner, or with spawner wake.");
        }
        const pending = await this.prisma.job.findFirst({ where: { environmentId: environment.id, type: "wake", status: { in: ["queued", "running"] } } });
        if (!pending) {
          try {
            await this.usage.ensureRoom(environment.projectId, "resume");
          } catch (error) {
            if (error instanceof LimitReachedException) {
              const body = error.getResponse() as { message: string };
              return view("no_room", `${body.message}. Try again in a while, or put another environment to sleep.`);
            }
            throw error;
          }
          await this.queue.enqueue(environment.id, "wake", null, null, `a visit to ${host}`);
        }
        return view("waking", "It went to sleep after a while without visits and is starting again. This page reloads by itself when it is ready, usually within seconds.");
      }
      case "waking":
        return view("waking", "It is starting again. This page reloads by itself when it is ready.");
      case "ready":
      case "degraded":
        return view("ready", "It is ready: reloading.");
      case "stopped":
        return view("stopped", "Someone stopped it. Start it again from Spawner, or with spawner start.");
      case "failed":
        return view("failed", `It failed${environment.phase ? ` while ${environment.phase}` : ""}: ${(environment.error ?? "unknown error").split("\n")[0].slice(0, 300)}`);
      default:
        return view("busy", `It is ${environment.status} right now. This page reloads by itself when it is ready.`);
    }
  }

  private refuse(response: Response, decision: Exclude<PreviewDecision, { status: 200 }>): void {
    if (decision.status === 302) {
      if (decision.cookie) {
        response.setHeader("Set-Cookie", decision.cookie);
      }
      response.redirect(302, decision.location);
      return;
    }
    response.status(decision.status).json(decision.body);
  }
}
