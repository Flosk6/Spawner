import { Injectable } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { Request } from "express";
import { PrismaService } from "../../common/prisma.service";
import { AuditService } from "../audit/audit.service";

/**
 * Dashboard sessions, stored in Postgres. A login always starts a new session
 * id, so a session created before the login (to hold a WebAuthn challenge)
 * cannot be fixed by someone else.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async login(request: Request, user: User, method: string): Promise<void> {
    await new Promise<void>((resolve, reject) => request.session.regenerate((error) => (error ? reject(error) : resolve())));
    request.session.userId = user.id;
    await new Promise<void>((resolve, reject) => request.session.save((error) => (error ? reject(error) : resolve())));
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record(null, "auth.login", { userId: user.id, actorName: user.name, details: { method }, request });
  }

  async logout(request: Request): Promise<void> {
    const actor = request.actor ?? null;
    await new Promise<void>((resolve, reject) => request.session.destroy((error) => (error ? reject(error) : resolve())));
    if (actor) {
      await this.audit.record(actor, "auth.logout", { request });
    }
  }
}
