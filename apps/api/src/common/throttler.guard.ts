import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Actor } from "./actor";

/**
 * Rate limits per user rather than per IP address: the agents of one
 * machine share an address, and a team behind one NAT too.
 */
@Injectable()
export class ActorThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(request: Record<string, unknown>): Promise<string> {
    const actor = request.actor as Actor | undefined;
    if (actor?.user) {
      return `user:${actor.user.id}`;
    }
    if (actor?.via === "bootstrap") {
      return "bootstrap";
    }
    return String(request.ip);
  }
}
