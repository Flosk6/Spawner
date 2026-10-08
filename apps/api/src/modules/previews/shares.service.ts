import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { assertCanAct, assertInProject, type Actor } from "../../common/actor";
import { PrismaService } from "../../common/prisma.service";
import { randomToken, sha256 } from "../../common/secrets.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { AuditService } from "../audit/audit.service";
import { PreviewsService, SHARE_PARAM } from "./previews.service";

export const SHARE_DEFAULT_HOURS = 24;
export const SHARE_MAX_HOURS = 14 * 24;

/**
 * Share links: a temporary link to an environment's previews for someone
 * without an account. Opening it sets a cookie valid for this environment
 * only, until the link expires or is revoked: the cookie names its link,
 * which each request checks.
 */
@Injectable()
export class SharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SpawnerConfig,
    private readonly audit: AuditService,
    private readonly previews: PreviewsService,
  ) {}

  async create(actor: Actor, environmentId: string, ttlHours: unknown) {
    const environment = await this.environment(actor, environmentId);
    assertCanAct(actor, "envs:write", environment);
    const hours = ttlHours === undefined ? SHARE_DEFAULT_HOURS : Number(ttlHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > SHARE_MAX_HOURS) {
      throw new BadRequestException(`ttlHours must be a whole number of hours between 1 and ${SHARE_MAX_HOURS}`);
    }
    const entrypoint = environment.exposures.find((exposure) => exposure.entrypoint) ?? environment.exposures[0];
    if (!entrypoint) {
      throw new ConflictException("the environment has no URL yet");
    }
    const token = randomToken(32);
    const share = await this.prisma.shareLink.create({
      data: { environmentId, tokenHash: sha256(token), createdById: actor.user?.id ?? null, expiresAt: new Date(Date.now() + hours * 3_600_000) },
    });
    await this.audit.record(actor, "env.share", { target: environment.slug, details: { shareId: share.id, hours } });
    return { id: share.id, url: `${this.config.scheme}://${entrypoint.host}/?${SHARE_PARAM}=${token}`, expiresAt: share.expiresAt };
  }

  async list(actor: Actor, environmentId: string) {
    await this.environment(actor, environmentId);
    const shares = await this.prisma.shareLink.findMany({
      where: { environmentId, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { createdBy: true },
      orderBy: { createdAt: "desc" },
    });
    return shares.map((share) => ({ id: share.id, createdBy: share.createdBy?.name ?? null, createdAt: share.createdAt, expiresAt: share.expiresAt }));
  }

  async revoke(actor: Actor, environmentId: string, shareId: string): Promise<void> {
    const environment = await this.environment(actor, environmentId);
    assertCanAct(actor, "envs:write", environment);
    const { count } = await this.prisma.shareLink.updateMany({ where: { id: shareId, environmentId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (count === 0) {
      throw new NotFoundException("share link not found");
    }
    this.previews.forgetShare(shareId);
    await this.audit.record(actor, "env.unshare", { target: environment.slug, details: { shareId } });
  }

  private async environment(actor: Actor, id: string) {
    const environment = await this.prisma.environment.findFirst({ where: { id, deletedAt: null }, include: { exposures: true } });
    if (!environment) {
      throw new NotFoundException(`environment "${id}" not found`);
    }
    assertInProject(actor, environment.projectId);
    return environment;
  }
}
