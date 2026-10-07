import { Injectable } from "@nestjs/common";
import type { Actor } from "../../common/actor";
import { randomToken } from "../../common/secrets.service";

const TICKET_SECONDS = 30;

/**
 * Who a ticket was issued to: the user, and the restrictions of the token
 * that asked for it, which the terminal keeps.
 */
export type TicketHolder = Pick<Actor, "via" | "scopes" | "tokenId" | "tokenName" | "projectId"> & { userId: number };

/**
 * One-time tickets for the terminal WebSocket. A ticket is obtained through a
 * request a page of another origin cannot make (it needs the X-Spawner-Client
 * header or a bearer token), lasts 30 seconds and works once: a preview
 * cannot open a terminal on behalf of a logged-in user.
 */
@Injectable()
export class WsTicketsService {
  private readonly tickets = new Map<string, TicketHolder & { expiresAt: number }>();

  issue(actor: Actor): { ticket: string; expiresAt: number } {
    const now = Date.now();
    for (const [ticket, entry] of this.tickets) {
      if (entry.expiresAt <= now) {
        this.tickets.delete(ticket);
      }
    }
    const ticket = randomToken(32);
    const expiresAt = now + TICKET_SECONDS * 1000;
    this.tickets.set(ticket, {
      userId: actor.user?.id ?? 0,
      via: actor.via,
      scopes: actor.scopes,
      tokenId: actor.tokenId,
      tokenName: actor.tokenName,
      projectId: actor.projectId,
      expiresAt,
    });
    return { ticket, expiresAt };
  }

  /**
   * Returns who a ticket was issued to and forgets the ticket, or null when
   * it is unknown or expired.
   */
  redeem(ticket: unknown): TicketHolder | null {
    if (typeof ticket !== "string") {
      return null;
    }
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!entry || entry.expiresAt <= Date.now()) {
      return null;
    }
    return { userId: entry.userId, via: entry.via, scopes: entry.scopes, tokenId: entry.tokenId, tokenName: entry.tokenName, projectId: entry.projectId };
  }
}
