import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { assertCanAct, bootstrapActor, describeActor, sessionActor, type Actor } from "./actor";

const admin = sessionActor({ id: 1, name: "Ada", role: "admin" });
const member = sessionActor({ id: 2, name: "Bob", role: "member" });
const agent: Actor = { ...member, via: "token", scopes: ["envs:read", "envs:write"], tokenId: "t", tokenName: "claude-laptop", projectId: "p1" };

describe("assertCanAct", () => {
  const own = { ownerId: 2, projectId: "p1" };
  const theirs = { ownerId: 1, projectId: "p1" };

  it("lets members act on their own environments and admins on all", () => {
    expect(() => assertCanAct(member, "envs:exec", own)).not.toThrow();
    expect(() => assertCanAct(member, "envs:write", theirs)).toThrow(ForbiddenException);
    expect(() => assertCanAct(member, "envs:exec", theirs)).toThrow(/owner of the environment or an admin/);
    expect(() => assertCanAct(admin, "envs:exec", theirs)).not.toThrow();
    expect(() => assertCanAct(bootstrapActor(), "envs:exec", { ownerId: null, projectId: "p9" })).not.toThrow();
  });

  it("holds tokens to their scopes and project", () => {
    expect(() => assertCanAct(agent, "envs:write", own)).not.toThrow();
    expect(() => assertCanAct(agent, "envs:exec", own)).toThrow(/envs:exec/);
    expect(() => assertCanAct(agent, "envs:write", { ownerId: 2, projectId: "p2" })).toThrow(/another project/);
  });
});

describe("describeActor", () => {
  it("names actors as the audit trail shows them", () => {
    expect(describeActor(member)).toBe("Bob");
    expect(describeActor(agent)).toBe("Bob via claude-laptop");
    expect(describeActor(bootstrapActor())).toBe("bootstrap token");
    expect(describeActor(null)).toBe("system");
  });
});
