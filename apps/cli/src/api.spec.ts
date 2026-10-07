import { describe, expect, it } from "vitest";
import { ApiClient, parseServerEvent } from "./api";
import { CliError, EXIT } from "./errors";
import { events, fakeFetch, reply, SERVER } from "./testing/fake-api";

describe("ApiClient", () => {
  it("sends the client header and the token", async () => {
    const calls: Parameters<typeof fakeFetch>[1] = [];
    const api = new ApiClient(SERVER, "spn_x", "mcp", fakeFetch({ "GET /envs": () => [] }, calls));
    await api.get("/envs", { project: "blog", slug: undefined });
    expect(calls[0].headers.get("authorization")).toBe("Bearer spn_x");
    expect(calls[0].headers.get("x-spawner-client")).toBe("mcp");
    expect(calls[0].query.toString()).toBe("project=blog");
  });

  it.each([
    [401, EXIT.auth, "unauthorized"],
    [403, EXIT.auth, "forbidden"],
    [404, EXIT.error, "not_found"],
    [409, EXIT.error, "conflict"],
    [500, EXIT.error, "server_error"],
  ])("turns a %d into exit code %d (%s)", async (status, exit, code) => {
    const api = new ApiClient(SERVER, "spn_x", "cli", fakeFetch({ "GET /envs/x": () => reply(status, { statusCode: status, message: "nope" }) }));
    const error = (await api.get("/envs/x").catch((failure) => failure)) as CliError;
    expect(error).toBeInstanceOf(CliError);
    expect({ exit: error.exit, code: error.code, message: error.message, status: error.status }).toEqual({ exit, code, message: "nope", status });
  });

  it("explains an unreachable server", async () => {
    const api = new ApiClient("http://127.0.0.1:9", "spn_x");
    await expect(api.get("/info")).rejects.toMatchObject({ code: "network" });
  });

  it("reads server-sent events and skips comments", async () => {
    const api = new ApiClient(SERVER, "spn_x", "cli", fakeFetch({ "GET /stream": () => events(': keep-alive\n\ndata: {"a":1}\n\nevent: ping\ndata: \n\ndata: two\ndata: lines\n\nevent: end\ndata: {}\n\n') }));
    const received = [];
    for await (const event of api.events("/stream")) {
      received.push(event);
    }
    expect(received).toEqual([
      { event: "message", data: '{"a":1}' },
      { event: "ping", data: "" },
      { event: "message", data: "two\nlines" },
      { event: "end", data: "{}" },
    ]);
  });

  it("parses single events", () => {
    expect(parseServerEvent(": comment")).toBeNull();
    expect(parseServerEvent("data:x")).toEqual({ event: "message", data: "x" });
  });
});
