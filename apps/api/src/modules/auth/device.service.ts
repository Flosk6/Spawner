import { ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { randomInt } from "crypto";
import { ROLE_SCOPES, isRole, type Actor } from "../../common/actor";
import { PrismaService } from "../../common/prisma.service";
import { randomToken, sha256 } from "../../common/secrets.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { AuditService } from "../audit/audit.service";
import { DEFAULT_TOKEN_DAYS, DEFAULT_TOKEN_SCOPES, TokensService } from "../tokens/tokens.service";

const LIFETIME_SECONDS = 600;
const INTERVAL_SECONDS = 5;
/** Consonants only: no word can form, and no letter looks like a digit. */
const CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

/**
 * Error codes of RFC 8628, answered with a 400 while the CLI polls.
 */
export type DeviceError = "authorization_pending" | "slow_down" | "access_denied" | "expired_token" | "invalid_grant";

/**
 * Login of the CLI (device flow, like `gh auth login`): the CLI shows a code,
 * its user approves it in the dashboard, and the CLI receives a personal
 * token named after the machine.
 */
@Injectable()
export class DeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly config: SpawnerConfig,
    private readonly audit: AuditService,
  ) {}

  async start(clientName: unknown) {
    const name = typeof clientName === "string" && clientName.trim() ? clientName.trim().slice(0, 40) : "cli";
    const deviceCode = randomToken(32);
    const userCode = await this.freeUserCode();
    await this.prisma.deviceCode.create({
      data: { deviceCodeHash: sha256(deviceCode), userCode, clientName: name, expiresAt: new Date(Date.now() + LIFETIME_SECONDS * 1000) },
    });
    return {
      deviceCode,
      userCode,
      verificationUri: `${this.config.dashboardUrl}/device`,
      verificationUriComplete: `${this.config.dashboardUrl}/device?code=${userCode}`,
      expiresIn: LIFETIME_SECONDS,
      interval: INTERVAL_SECONDS,
    };
  }

  /**
   * Answers a poll of the CLI: the token once the login is approved, else
   * the RFC 8628 error that tells the CLI what to do.
   */
  async poll(deviceCode: unknown) {
    const record = typeof deviceCode === "string" ? await this.prisma.deviceCode.findUnique({ where: { deviceCodeHash: sha256(deviceCode) } }) : null;
    if (!record || record.status === "consumed") {
      throw deviceError("invalid_grant");
    }
    if (record.expiresAt <= new Date()) {
      throw deviceError("expired_token");
    }
    if (record.status === "denied") {
      throw deviceError("access_denied");
    }
    if (record.status === "pending") {
      const tooSoon = record.lastPolledAt && Date.now() - record.lastPolledAt.getTime() < INTERVAL_SECONDS * 1000;
      await this.prisma.deviceCode.update({ where: { id: record.id }, data: { lastPolledAt: new Date() } });
      throw deviceError(tooSoon ? "slow_down" : "authorization_pending");
    }

    const claimed = await this.prisma.deviceCode.updateMany({ where: { id: record.id, status: "approved" }, data: { status: "consumed" } });
    const user = record.userId ? await this.prisma.user.findUnique({ where: { id: record.userId } }) : null;
    if (claimed.count !== 1 || !user?.isActive || !isRole(user.role)) {
      throw deviceError("invalid_grant");
    }
    const scopes = DEFAULT_TOKEN_SCOPES.filter((scope) => ROLE_SCOPES[user.role as "admin" | "member"].includes(scope));
    const { token, info } = await this.tokens.issue(user.id, { name: record.clientName, scopes, days: DEFAULT_TOKEN_DAYS });
    return { token, ...info, user: { id: user.id, name: user.name, role: user.role } };
  }

  /**
   * What the approval page shows about a pending login.
   */
  async describe(actor: Actor, userCode: string) {
    this.requireSession(actor);
    const record = await this.pending(userCode);
    return { userCode: record.userCode, clientName: record.clientName, expiresAt: record.expiresAt, scopes: DEFAULT_TOKEN_SCOPES };
  }

  async decide(actor: Actor, userCode: unknown, approve: boolean) {
    this.requireSession(actor);
    const record = await this.pending(userCode);
    await this.prisma.deviceCode.update({ where: { id: record.id }, data: { status: approve ? "approved" : "denied", userId: actor.user?.id } });
    await this.audit.record(actor, approve ? "device.approve" : "device.deny", { target: record.clientName });
    return { status: approve ? "approved" : "denied" };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purge(): Promise<void> {
    await this.prisma.deviceCode.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } } });
  }

  private requireSession(actor: Actor): void {
    if (actor.via !== "session") {
      throw new ForbiddenException("approve logins from the dashboard");
    }
  }

  private async pending(userCode: unknown) {
    const code = normalizeUserCode(userCode);
    const record = code ? await this.prisma.deviceCode.findUnique({ where: { userCode: code } }) : null;
    if (!record || record.status !== "pending" || record.expiresAt <= new Date()) {
      throw new NotFoundException("this code is unknown or expired: run the login again");
    }
    return record;
  }

  private async freeUserCode(): Promise<string> {
    for (;;) {
      const letters = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
      const code = `${letters.slice(0, 4)}-${letters.slice(4)}`;
      if (!(await this.prisma.deviceCode.findUnique({ where: { userCode: code } }))) {
        return code;
      }
    }
  }
}

/**
 * Accepts the code as typed: any case, with or without the dash or spaces.
 */
export function normalizeUserCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const letters = value.toUpperCase().replace(/[^A-Z]/g, "");
  return letters.length === 8 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : null;
}

function deviceError(error: DeviceError): HttpException {
  return new HttpException({ error }, HttpStatus.BAD_REQUEST);
}
