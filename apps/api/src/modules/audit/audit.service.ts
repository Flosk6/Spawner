import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import type { Request } from "express";
import { describeActor, type Actor } from "../../common/actor";
import { PrismaService } from "../../common/prisma.service";
import { requestContext } from "../../common/request-context";

const RETENTION_DAYS = 90;
const PAGE_MAX = 200;

export interface AuditOptions {
  target?: string;
  details?: Record<string, unknown>;
  request?: Request;
  /** User the event belongs to when there is no actor yet (a login). */
  userId?: number;
  /** Name shown when there is no actor yet. */
  actorName?: string;
}

/**
 * Audit trail: logins, invitations, tokens, projects, actions on
 * environments, commands and terminals, settings. Kept 90 days, read by
 * admins.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records an event, with the address and the user agent of the request
   * that caused it (the request given, or the one being served). A failed
   * write is logged and never fails the request that caused it.
   */
  async record(actor: Actor | null, action: string, options: AuditOptions = {}): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          userId: options.userId ?? actor?.user?.id ?? null,
          actor: (options.actorName ?? describeActor(actor)).slice(0, 100),
          action,
          target: options.target?.slice(0, 200) ?? null,
          details: (options.details as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          ip: (options.request ? options.request.ip : requestContext()?.ip)?.slice(0, 64) ?? null,
          userAgent: (options.request ? options.request.headers["user-agent"] : requestContext()?.userAgent)?.slice(0, 300) ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(`Could not record ${action}: ${(error as Error).message}`);
    }
  }

  /**
   * Most recent events first, PAGE_MAX at most, before an event id to page.
   */
  async list(options: { limit?: number; before?: number; action?: string }) {
    return this.prisma.auditEvent.findMany({
      where: {
        ...(options.before ? { id: { lt: options.before } } : {}),
        ...(options.action ? { action: { startsWith: options.action } } : {}),
      },
      select: { id: true, createdAt: true, userId: true, actor: true, action: true, target: true, details: true, ip: true },
      orderBy: { id: "desc" },
      take: Math.min(Math.max(options.limit ?? 50, 1), PAGE_MAX),
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purge(): Promise<void> {
    const { count } = await this.prisma.auditEvent.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - RETENTION_DAYS * 86_400_000) } },
    });
    if (count > 0) {
      this.logger.log(`Removed ${count} audit events older than ${RETENTION_DAYS} days`);
    }
  }
}
