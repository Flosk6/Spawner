import { BadRequestException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { hasScope, type Actor } from "../../common/actor";
import { PrismaService } from "../../common/prisma.service";
import { SecretsService, sha256 } from "../../common/secrets.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { ActivityService } from "../lifecycle/activity.service";

export const PREVIEW_COOKIE = "spawner_preview";
export const SHARE_COOKIE_PREFIX = "spawner_share_";
export const SHARE_PARAM = "__spawner_share";
export const PREVIEW_HEADER = "x-spawner-preview";

const PREVIEW_COOKIE_SECONDS = 12 * 3600;
const PREVIEW_HEADER_SECONDS = 3600;
const HOST_CACHE_MS = 30_000;
const USER_CACHE_MS = 60_000;

/** The original request, as Traefik describes it to forwardAuth. */
export interface PreviewRequest {
  method: string;
  proto: string;
  host: string;
  uri: string;
  accept: string;
  cookies: Record<string, string>;
  header: string | undefined;
}

/** What forwardAuth answers Traefik. */
export type PreviewDecision =
  | { status: 200; environmentId: string }
  | { status: 302; location: string; cookie?: string }
  | { status: 401 | 404; body: { error: string; loginUrl?: string } };

interface PreviewClaims {
  exp: number;
  /** User the token was given to; none for the bootstrap token. */
  sub?: number;
  /** Environment the token is limited to. */
  env?: string;
}

/**
 * Who may open a preview. Before each request to an exposure with `auth:
 * team`, Traefik asks this service (forwardAuth). A request passes with a
 * preview token header (agents), a share link or its cookie (guests), or the
 * team's preview cookie, set by the dashboard for logged-in users. Browsers
 * without any are sent to the dashboard to log in; other clients get a 401.
 */
@Injectable()
export class PreviewsService implements OnModuleInit {
  private readonly logger = new Logger(PreviewsService.name);
  private readonly hosts = new Map<string, { environmentId: string | null; until: number }>();
  private readonly users = new Map<number, { active: boolean; until: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly config: SpawnerConfig,
    private readonly activity: ActivityService,
  ) {}

  /**
   * The team cookie is set by the dashboard on the preview domain: a
   * dashboard elsewhere cannot let logged-in users into previews.
   */
  onModuleInit(): void {
    const host = new URL(this.config.dashboardUrl).hostname;
    if (!host.endsWith(`.${this.config.previewDomain}`)) {
      this.logger.warn(
        `The dashboard (${this.config.dashboardUrl}) is not under the preview domain (${this.config.previewDomain}): logged-in users will not get into protected previews. Set FRONTEND_URL to a host of ${this.config.previewDomain}.`,
      );
    }
  }

  async decide(request: PreviewRequest): Promise<PreviewDecision> {
    const environmentId = await this.environmentOf(request.host.replace(/:\d+$/, ""));
    if (!environmentId) {
      return { status: 404, body: { error: "unknown_preview" } };
    }
    if (request.method === "OPTIONS") {
      return this.allow(environmentId);
    }

    const header = this.secrets.verify<PreviewClaims>("preview-header", request.header);
    if (header && (!header.env || header.env === environmentId) && (await this.isActive(header.sub))) {
      return this.allow(environmentId);
    }

    const url = new URL(request.uri || "/", `${request.proto}://${request.host}`);
    const shareToken = url.searchParams.get(SHARE_PARAM);
    if (shareToken) {
      const share = await this.prisma.shareLink.findUnique({ where: { tokenHash: sha256(shareToken) } });
      if (share && share.environmentId === environmentId && !share.revokedAt && share.expiresAt > new Date()) {
        url.searchParams.delete(SHARE_PARAM);
        const exp = Math.floor(share.expiresAt.getTime() / 1000);
        return {
          status: 302,
          location: url.toString(),
          cookie: this.cookie(`${SHARE_COOKIE_PREFIX}${environmentId}`, this.secrets.sign<PreviewClaims>("share", { exp, env: environmentId }), exp),
        };
      }
    }

    const team = this.secrets.verify<PreviewClaims>("preview-cookie", request.cookies[PREVIEW_COOKIE]);
    if (team && (await this.isActive(team.sub))) {
      return this.allow(environmentId);
    }
    const shared = this.secrets.verify<PreviewClaims>("share", request.cookies[`${SHARE_COOKIE_PREFIX}${environmentId}`]);
    if (shared?.env === environmentId) {
      return this.allow(environmentId);
    }

    const loginUrl = `${this.config.dashboardUrl}/api/v1/auth/preview?next=${encodeURIComponent(url.toString())}`;
    if (["GET", "HEAD"].includes(request.method) && request.accept.includes("text/html")) {
      return { status: 302, location: loginUrl };
    }
    return { status: 401, body: { error: "preview_auth_required", loginUrl } };
  }

  /**
   * The team cookie for a logged-in user, and where to send them back.
   *
   * @param next - The preview URL the user was going to
   * @returns The Set-Cookie value and the checked next URL
   */
  previewCookie(actor: Actor, next: unknown): { cookie: string; next: string } {
    const target = this.previewUrl(next);
    if (!hasScope(actor, "preview")) {
      throw new BadRequestException("this account cannot open previews");
    }
    const exp = Math.floor(Date.now() / 1000) + PREVIEW_COOKIE_SECONDS;
    return { cookie: this.cookie(PREVIEW_COOKIE, this.secrets.sign<PreviewClaims>("preview-cookie", { exp, sub: actor.user?.id }), exp), next: target };
  }

  /**
   * A short token for agents and scripts: sent as the X-Spawner-Preview
   * header, it opens the previews of one environment for an hour. Traefik
   * removes it before the request reaches the application.
   */
  headerToken(actor: Actor, environmentId: string) {
    const exp = Math.floor(Date.now() / 1000) + PREVIEW_HEADER_SECONDS;
    return {
      header: "X-Spawner-Preview",
      token: this.secrets.sign<PreviewClaims>("preview-header", { exp, sub: actor.user?.id, env: environmentId }),
      expiresAt: new Date(exp * 1000),
    };
  }

  /**
   * Checks that next is a preview URL of this installation, so the login
   * page can never send anyone to another site.
   */
  previewUrl(next: unknown): string {
    let url: URL;
    try {
      url = new URL(String(next));
    } catch {
      throw new BadRequestException("next must be the URL of a preview");
    }
    if (url.protocol !== `${this.config.scheme}:` || !url.hostname.endsWith(`.${this.config.previewDomain}`)) {
      throw new BadRequestException("next must be the URL of a preview");
    }
    return url.toString();
  }

  private allow(environmentId: string): PreviewDecision {
    this.activity.touch(environmentId);
    return { status: 200, environmentId };
  }

  private cookie(name: string, value: string, exp: number): string {
    const maxAge = Math.max(0, exp - Math.floor(Date.now() / 1000));
    return [
      `${name}=${value}`,
      `Domain=${this.config.previewDomain}`,
      "Path=/",
      `Max-Age=${maxAge}`,
      "HttpOnly",
      "SameSite=Lax",
      ...(this.config.scheme === "https" ? ["Secure"] : []),
    ].join("; ");
  }

  private async environmentOf(host: string): Promise<string | null> {
    const now = Date.now();
    const cached = this.hosts.get(host);
    if (cached && cached.until > now) {
      return cached.environmentId;
    }
    const exposure = await this.prisma.exposure.findFirst({
      where: { host, environment: { deletedAt: null } },
      select: { environmentId: true },
    });
    const environmentId = exposure?.environmentId ?? null;
    this.hosts.set(host, { environmentId, until: now + HOST_CACHE_MS });
    return environmentId;
  }

  /** A token given to a user is only worth something while the user is active. */
  private async isActive(userId: number | undefined): Promise<boolean> {
    if (userId === undefined) {
      return true;
    }
    const now = Date.now();
    const cached = this.users.get(userId);
    if (cached && cached.until > now) {
      return cached.active;
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
    const active = user?.isActive ?? false;
    this.users.set(userId, { active, until: now + USER_CACHE_MS });
    return active;
  }
}

/**
 * Reads a Cookie header into a map; the last value of a repeated name wins.
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) {
      cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
    }
  }
  return cookies;
}
