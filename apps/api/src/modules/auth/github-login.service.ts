import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { Request } from "express";
import { PrismaService } from "../../common/prisma.service";
import { randomToken } from "../../common/secrets.service";
import { AuditService } from "../audit/audit.service";
import { SettingsService, type GithubSettings } from "../settings/settings.service";
import { freeName } from "../team/user-names";

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const API_URL = "https://api.github.com";
const TIMEOUT_MS = 10_000;

interface GithubProfile {
  id: number;
  login: string;
  avatar_url?: string;
}

/**
 * Optional GitHub login (OAuth app), configured from the settings page. When
 * an organization is set, membership (of the team, when one is set too) is
 * checked at every login, and its members get a member account on their first
 * login; otherwise only accounts linked to GitHub can use it.
 */
@Injectable()
export class GithubLoginService {
  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The GitHub authorization URL to send the browser to.
   *
   * @param next - Dashboard path to open after the login
   * @param link - Links the GitHub account to the logged-in user instead of logging in
   */
  async start(request: Request, next: string | null, link: boolean): Promise<string> {
    const github = await this.require();
    const state = randomToken(16);
    request.session.github = { state, next, link };
    await new Promise<void>((resolve, reject) => request.session.save((error) => (error ? reject(error) : resolve())));
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", github.clientId);
    url.searchParams.set("redirect_uri", github.callbackUrl);
    url.searchParams.set("scope", github.org ? "read:org" : "");
    url.searchParams.set("state", state);
    url.searchParams.set("allow_signup", "false");
    return url.toString();
  }

  /**
   * Finishes the flow GitHub redirected back with.
   *
   * @param currentUserId - Logged-in user, for a link
   * @returns The user to log in (or the one the account was linked to), and the path to open
   */
  async finish(request: Request, code: unknown, state: unknown, currentUserId: number | null): Promise<{ user: User; next: string | null; linked: boolean }> {
    const pending = request.session.github;
    delete request.session.github;
    if (!pending || typeof state !== "string" || pending.state !== state || typeof code !== "string") {
      throw new BadRequestException("the GitHub login expired or did not start here: try again");
    }
    const github = await this.require();
    const accessToken = await this.exchange(github, code);
    const profile = await this.api<GithubProfile>(accessToken, "/user");
    const subject = String(profile.id);

    if (github.org && !(await this.isMember(accessToken, github, profile.login))) {
      throw new ForbiddenException(github.team ? `members of the ${github.team} team of ${github.org} only` : `members of ${github.org} only`);
    }

    const identity = await this.prisma.identity.findUnique({ where: { provider_subject: { provider: "github", subject } }, include: { user: true } });

    if (pending.link) {
      if (!currentUserId) {
        throw new BadRequestException("log in before linking a GitHub account");
      }
      if (identity && identity.userId !== currentUserId) {
        throw new ConflictException("this GitHub account is already linked to another user");
      }
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: currentUserId } });
      if (!identity) {
        await this.prisma.identity.create({ data: { userId: currentUserId, provider: "github", subject, username: profile.login } });
        await this.audit.record(null, "user.github_link", { userId: user.id, actorName: user.name, target: profile.login, details: { githubId: subject }, request });
      }
      return { user, next: pending.next, linked: true };
    }

    if (identity) {
      if (!identity.user.isActive) {
        throw new ForbiddenException("this account is deactivated");
      }
      await this.prisma.identity.update({ where: { id: identity.id }, data: { username: profile.login } });
      const user = await this.prisma.user.update({ where: { id: identity.userId }, data: { avatarUrl: profile.avatar_url ?? identity.user.avatarUrl } });
      return { user, next: pending.next, linked: false };
    }

    if (!github.org) {
      throw new ForbiddenException("no Spawner account uses this GitHub account: ask an admin for an invitation, then link GitHub from your account page");
    }
    const user = await this.prisma.user.create({
      data: {
        name: await freeName(this.prisma, profile.login),
        avatarUrl: profile.avatar_url ?? null,
        role: "member",
        identities: { create: { provider: "github", subject, username: profile.login } },
      },
    });
    return { user, next: pending.next, linked: false };
  }

  private async require(): Promise<GithubSettings> {
    const github = await this.settings.github();
    if (!github) {
      throw new NotFoundException("GitHub login is not configured");
    }
    return github;
  }

  private async exchange(github: GithubSettings, code: string): Promise<string> {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: github.clientId, client_secret: github.clientSecret, code, redirect_uri: github.callbackUrl }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
    if (!response.ok || !body.access_token) {
      throw new BadRequestException(`GitHub refused the login: ${body.error_description ?? response.statusText}`);
    }
    return body.access_token;
  }

  private async isMember(accessToken: string, github: GithubSettings, login: string): Promise<boolean> {
    const path = github.team
      ? `/orgs/${encodeURIComponent(github.org as string)}/teams/${encodeURIComponent(github.team.toLowerCase())}/memberships/${encodeURIComponent(login)}`
      : `/user/memberships/orgs/${encodeURIComponent(github.org as string)}`;
    const membership = await this.api<{ state?: string }>(accessToken, path).catch(() => null);
    return membership?.state === "active";
  }

  private async api<T>(accessToken: string, path: string): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${accessToken}`, "User-Agent": "Spawner", "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new BadRequestException(`GitHub answered ${response.status} to ${path}`);
    }
    return (await response.json()) as T;
  }
}
