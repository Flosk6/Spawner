import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { isRole, sessionActor, tokenActor, type Actor } from "./actor";
import { PrismaService } from "./prisma.service";

const RECHECK_MS = 30_000;

interface Watch {
  actor: Actor;
  allowed: (actor: Actor) => void;
  lost: (reason: string) => void;
}

/**
 * Holds long-lived connections, terminals and log streams, to what their
 * actor may still do. A request reads its actor once: without this, a
 * terminal or a stream opened by someone then deactivated or demoted, or
 * with a token then revoked or expired, would keep its rights until it
 * closes. Each watched connection reads its actor again when that user's
 * access changes (changed()) and every 30 seconds, for expiries, and ends
 * once the actor is gone or no longer allowed.
 */
@Injectable()
export class AccessService implements OnModuleDestroy {
  private readonly watches = new Set<Watch>();
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {
    this.timer = setInterval(() => void this.recheck(), RECHECK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /**
   * The actor as it stands now: null once its user is deactivated or its
   * token revoked or expired, otherwise with the scopes its role and token
   * still allow, never more than it had.
   */
  async refresh(actor: Actor): Promise<Actor | null> {
    if (actor.via === "bootstrap") {
      return actor;
    }
    let fresh: Actor | null = null;
    if (actor.via === "token") {
      const record = actor.tokenId ? await this.prisma.apiToken.findUnique({ where: { id: actor.tokenId }, include: { user: true } }) : null;
      fresh = record ? tokenActor(record) : null;
    } else if (actor.user) {
      const user = await this.prisma.user.findUnique({ where: { id: actor.user.id } });
      fresh = user?.isActive && isRole(user.role) ? sessionActor({ id: user.id, name: user.name, role: user.role }) : null;
    }
    return fresh && { ...actor, user: fresh.user, scopes: actor.scopes.filter((scope) => fresh.scopes.includes(scope)) };
  }

  /**
   * Watches an open connection until it closes: lost is called once, with
   * the reason, when its actor is gone or allowed throws for the actor as it
   * stands now. A failed read of the database keeps the connection until the
   * next check.
   *
   * @param allowed - Throws when the actor may no longer keep the connection
   * @returns Stops watching
   */
  watch(actor: Actor, allowed: (actor: Actor) => void, lost: (reason: string) => void): () => void {
    const watch = { actor, allowed, lost };
    this.watches.add(watch);
    return () => void this.watches.delete(watch);
  }

  /**
   * Checks again the connections of a user who was deactivated or got
   * another role, or one of whose tokens was revoked.
   */
  async changed(userId: number): Promise<void> {
    await Promise.all([...this.watches].filter((watch) => watch.actor.user?.id === userId).map((watch) => this.check(watch)));
  }

  /** Checks every watched connection again, for the tokens that expired. */
  async recheck(): Promise<void> {
    await Promise.all([...this.watches].map((watch) => this.check(watch)));
  }

  private async check(watch: Watch): Promise<void> {
    let actor: Actor | null;
    try {
      actor = await this.refresh(watch.actor);
    } catch {
      return;
    }
    let reason = "access revoked or expired";
    if (actor) {
      try {
        watch.allowed(actor);
        return;
      } catch (error) {
        reason = (error as Error).message;
      }
    }
    if (this.watches.delete(watch)) {
      watch.lost(reason);
    }
  }
}

