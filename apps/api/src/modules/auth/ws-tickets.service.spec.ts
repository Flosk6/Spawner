import { describe, expect, it } from "vitest";
import { sessionActor, type Actor } from "../../common/actor";
import { WsTicketsService } from "./ws-tickets.service";

describe("WsTicketsService", () => {
  it("keeps the restrictions of the token that asked for the ticket", () => {
    const tickets = new WsTicketsService();
    const actor: Actor = { ...sessionActor({ id: 4, name: "Ada", role: "admin" }), via: "token", scopes: ["envs:exec"], tokenId: "t1", tokenName: "claude", projectId: "p1" };
    const { ticket } = tickets.issue(actor);
    expect(tickets.redeem(ticket)).toEqual({ userId: 4, via: "token", scopes: ["envs:exec"], tokenId: "t1", tokenName: "claude", projectId: "p1" });
  });

  it("works once", () => {
    const tickets = new WsTicketsService();
    const { ticket } = tickets.issue(sessionActor({ id: 1, name: "Ada", role: "member" }));
    expect(tickets.redeem(ticket)).not.toBeNull();
    expect(tickets.redeem(ticket)).toBeNull();
    expect(tickets.redeem(undefined)).toBeNull();
  });
});
