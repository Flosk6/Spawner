import { Injectable } from "@nestjs/common";
import { randomToken } from "../../common/secrets.service";

const TICKET_SECONDS = 30;

/**
 * One-time tickets for the terminal WebSocket. A ticket is obtained through a
 * request a page of another origin cannot make (it needs the X-Spawner-Client
 * header), lasts 30 seconds and works once: a preview cannot open a terminal
 * on behalf of a logged-in user.
 */
@Injectable()
export class WsTicketsService {
  private readonly tickets = new Map<string, { userId: number; expiresAt: number }>();

  issue(userId: number): { ticket: string; expiresAt: number } {
    const now = Date.now();
    for (const [ticket, entry] of this.tickets) {
      if (entry.expiresAt <= now) {
        this.tickets.delete(ticket);
      }
    }
    const ticket = randomToken(32);
    const expiresAt = now + TICKET_SECONDS * 1000;
    this.tickets.set(ticket, { userId, expiresAt });
    return { ticket, expiresAt };
  }

  /**
   * Returns the user a ticket was issued to and forgets the ticket, or null
   * when it is unknown or expired.
   */
  redeem(ticket: unknown): number | null {
    if (typeof ticket !== "string") {
      return null;
    }
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    return entry && entry.expiresAt > Date.now() ? entry.userId : null;
  }
}
