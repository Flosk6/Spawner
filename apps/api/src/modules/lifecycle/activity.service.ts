import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";

/** Activity is written at most this often per environment. */
const WRITE_EVERY_MS = 60_000;

/**
 * Records that an environment is in use: a request let through to one of its
 * URLs, or an action on it (a deploy, a command, its logs, a terminal). An
 * environment sleeps once its last activity is older than its idle time.
 */
@Injectable()
export class ActivityService {
  private readonly written = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  touch(environmentId: string): void {
    const now = Date.now();
    if (now - (this.written.get(environmentId) ?? 0) < WRITE_EVERY_MS) {
      return;
    }
    this.written.set(environmentId, now);
    void this.prisma.environment.update({ where: { id: environmentId }, data: { lastActivityAt: new Date(now) } }).catch(() => undefined);
  }
}
