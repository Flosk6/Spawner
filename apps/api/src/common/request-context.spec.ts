import { describe, expect, it } from "vitest";
import { requestContext, withRequestContext } from "./request-context";

describe("withRequestContext", () => {
  it("gives what the request causes, later included, its client, and nothing outside it", async () => {
    const seen: unknown[] = [];
    await new Promise<void>((resolve) =>
      withRequestContext({ ip: "203.0.113.7", headers: { "user-agent": "spawner/2.2.0" } } as never, {} as never, () => {
        setTimeout(() => {
          seen.push(requestContext());
          resolve();
        }, 1);
      }),
    );
    expect(seen).toEqual([{ ip: "203.0.113.7", userAgent: "spawner/2.2.0" }]);
    expect(requestContext()).toBeUndefined();
  });
});
