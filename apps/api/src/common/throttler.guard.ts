import { Injectable } from "@nestjs/common";
import { SkipThrottle, ThrottlerGuard } from "@nestjs/throttler";
import type { Actor } from "./actor";

/**
 * The rate limits of every route, per user or per address: 10 requests a
 * second, 60 in 10 seconds, 300 a minute. Login routes set tighter ones.
 */
export const THROTTLERS = [
  { name: "short", ttl: 1000, limit: 10 },
  { name: "medium", ttl: 10_000, limit: 60 },
  { name: "long", ttl: 60_000, limit: 300 },
];

/**
 * Lifts every rate limit from a route or a controller. `@SkipThrottle()`
 * alone only lifts the limit named "default", which this application does
 * not have: Traefik's checks before each request to a preview were limited
 * to 10 a second, fewer than a page loads at once.
 */
export const NoThrottle = () => SkipThrottle(Object.fromEntries(THROTTLERS.map((throttler) => [throttler.name, true])));

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
