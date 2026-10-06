import { BadRequestException, Injectable } from "@nestjs/common";
import type { Actor } from "../../common/actor";
import { PrismaService } from "../../common/prisma.service";
import { SecretsService } from "../../common/secrets.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { AuditService } from "../audit/audit.service";

const GITHUB = {
  enabled: "github.enabled",
  clientId: "github.client_id",
  clientSecret: "github.client_secret",
  org: "github.org",
  team: "github.team",
} as const;

/** GitHub login, ready to use. */
export interface GithubSettings {
  clientId: string;
  clientSecret: string;
  org: string | null;
  team: string | null;
  callbackUrl: string;
}

export interface GithubSettingsInput {
  enabled?: unknown;
  clientId?: unknown;
  clientSecret?: unknown;
  org?: unknown;
  team?: unknown;
}

/**
 * Settings changed from the interface, in the settings table. Secret values
 * are encrypted. GitHub login falls back to the GITHUB_* variables until it
 * is configured from the interface.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly config: SpawnerConfig,
    private readonly audit: AuditService,
  ) {}

  get githubCallbackUrl(): string {
    return process.env.GITHUB_CALLBACK_URL || `${this.config.dashboardUrl}/api/v1/auth/github/callback`;
  }

  /**
   * GitHub login settings, or null when GitHub login is off.
   */
  async github(): Promise<GithubSettings | null> {
    const stored = await this.read(Object.values(GITHUB));
    if (stored.has(GITHUB.enabled)) {
      const secret = stored.get(GITHUB.clientSecret);
      if (stored.get(GITHUB.enabled) !== "true" || !stored.get(GITHUB.clientId) || !secret) {
        return null;
      }
      return {
        clientId: stored.get(GITHUB.clientId) as string,
        clientSecret: this.secrets.decrypt(secret),
        org: stored.get(GITHUB.org) || null,
        team: stored.get(GITHUB.team) || null,
        callbackUrl: this.githubCallbackUrl,
      };
    }
    const fromEnv = (name: string) => {
      const value = process.env[name];
      return value && value !== "unset" ? value : null;
    };
    const clientId = fromEnv("GITHUB_CLIENT_ID");
    const clientSecret = fromEnv("GITHUB_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      return null;
    }
    return { clientId, clientSecret, org: fromEnv("GITHUB_ORG"), team: fromEnv("GITHUB_TEAM"), callbackUrl: this.githubCallbackUrl };
  }

  /**
   * What the settings page shows: never the client secret itself.
   */
  async githubView() {
    const stored = await this.read(Object.values(GITHUB));
    const active = await this.github();
    return {
      enabled: active !== null,
      source: stored.has(GITHUB.enabled) ? "settings" : active ? "environment" : "none",
      clientId: stored.get(GITHUB.clientId) ?? active?.clientId ?? "",
      hasSecret: stored.has(GITHUB.clientSecret) || Boolean(active),
      org: stored.get(GITHUB.org) ?? active?.org ?? "",
      team: stored.get(GITHUB.team) ?? active?.team ?? "",
      callbackUrl: this.githubCallbackUrl,
    };
  }

  /**
   * Saves the GitHub login settings. An empty client secret keeps the one
   * already saved.
   */
  async updateGithub(actor: Actor, input: GithubSettingsInput) {
    const text = (value: unknown, field: string, max: number) => {
      if (value === undefined || value === null) {
        return "";
      }
      if (typeof value !== "string" || value.trim().length > max) {
        throw new BadRequestException(`${field} must be text, ${max} characters at most`);
      }
      return value.trim();
    };
    const enabled = input.enabled === true;
    const clientId = text(input.clientId, "clientId", 100);
    const clientSecret = text(input.clientSecret, "clientSecret", 200);
    const org = text(input.org, "org", 100);
    const team = text(input.team, "team", 100);
    const current = await this.read([GITHUB.clientSecret]);

    if (enabled && (!clientId || (!clientSecret && !current.has(GITHUB.clientSecret)))) {
      throw new BadRequestException("GitHub login needs the client id and the client secret of an OAuth app");
    }
    if (team && !org) {
      throw new BadRequestException("a team belongs to an organization: set the organization too");
    }

    const values: Record<string, string> = { [GITHUB.enabled]: String(enabled), [GITHUB.clientId]: clientId, [GITHUB.org]: org, [GITHUB.team]: team };
    if (clientSecret) {
      values[GITHUB.clientSecret] = this.secrets.encrypt(clientSecret);
    }
    await this.prisma.$transaction(
      Object.entries(values).map(([key, value]) => this.prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } })),
    );
    await this.audit.record(actor, "settings.github", { details: { enabled, clientId, org, team, secretChanged: Boolean(clientSecret) } });
    return this.githubView();
  }

  private async read(keys: readonly string[]): Promise<Map<string, string>> {
    const rows = await this.prisma.setting.findMany({ where: { key: { in: [...keys] } } });
    return new Map(rows.map((row) => [row.key, row.value]));
  }
}
