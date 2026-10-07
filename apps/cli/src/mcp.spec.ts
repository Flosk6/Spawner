import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "./mcp";
import { fakeContext, fakeFetch, INFO, reply, type FakeRequest } from "./testing/fake-api";
import { COMPOSE, git, MANIFEST, repo } from "./testing/repo";

const ENVIRONMENT = {
  id: "env-1",
  project: "example",
  slug: "feat-login",
  status: "ready",
  exposures: [{ name: "web", service: "app", port: 3000, host: "feat-login--example.localtest.me", entrypoint: true, auth: "team" }],
  urls: { web: "http://feat-login--example.localtest.me" },
};

async function connect(routes: Record<string, (request: FakeRequest) => unknown>, calls: FakeRequest[] = []) {
  const cwd = repo({ ".spawner/spawner.yaml": MANIFEST, ".spawner/compose.yaml": COMPOSE, Dockerfile: "FROM node:22" });
  git(cwd, "checkout", "-q", "-b", "feat/login");
  const fetchImpl = fakeFetch({ "GET /info": () => INFO, "GET /envs": () => [ENVIRONMENT], ...routes }, calls);
  const server = createMcpServer({ cwd, env: {}, context: fakeContext(cwd, fetchImpl, "mcp") });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, cwd };
}

function text(result: CallToolResult): string {
  return result.content.map((item) => (item.type === "text" ? item.text : "")).join("\n");
}

describe("MCP server", () => {
  it("lists the tools of the specification, spawner_down marked destructive", async () => {
    const { client } = await connect({});
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "spawner_down",
      "spawner_exec",
      "spawner_list",
      "spawner_logs",
      "spawner_share",
      "spawner_stats",
      "spawner_status",
      "spawner_up",
      "spawner_url",
    ]);
    expect(tools.find((tool) => tool.name === "spawner_down")?.annotations).toMatchObject({ destructiveHint: true });
    expect(tools.find((tool) => tool.name === "spawner_status")?.annotations).toMatchObject({ readOnlyHint: true });
    expect(tools.find((tool) => tool.name === "spawner_down")?.inputSchema.required).toEqual(["env"]);
  });

  it("creates the environment of the worktree, reporting progress", async () => {
    let polls = 0;
    const calls: FakeRequest[] = [];
    const { client } = await connect(
      {
        "GET /projects/example": () => ({ slug: "example", rootDir: "." }),
        "GET /envs": () => reply(404, { message: "not found" }),
        "POST /envs": () => ({ environment: { ...ENVIRONMENT, status: "queued" }, job: { id: "job-1", environmentId: "env-1", type: "create", status: "queued" } }),
        "GET /jobs/job-1": () => ({ id: "job-1", environmentId: "env-1", type: "create", status: ++polls > 1 ? "succeeded" : "running" }),
        "GET /envs/env-1": () => ({ ...ENVIRONMENT, status: polls > 1 ? "ready" : "building" }),
      },
      calls,
    );
    const progress: string[] = [];
    const result = (await client.callTool({ name: "spawner_up", arguments: {} }, CallToolResultSchema, {
      onprogress: (notification) => progress.push(notification.message ?? ""),
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toMatchObject({ action: "created", environment: { slug: "feat-login", status: "ready" } });
    expect(calls.find((call) => call.method === "POST")?.form?.get("createdVia")).toBe("mcp");
    expect(progress).toEqual(expect.arrayContaining([expect.stringMatching(/^Packing app/), "building...", expect.stringMatching(/^Ready in/)]));
  });

  it("answers a failed build with the end of its log, as a tool error", async () => {
    const { client } = await connect({
      "GET /projects/example": () => ({ slug: "example", rootDir: "." }),
      "POST /envs/env-1/update": () => ({ environment: ENVIRONMENT, job: { id: "job-1", environmentId: "env-1", type: "update", status: "queued" } }),
      "GET /jobs/job-1": () => ({ id: "job-1", environmentId: "env-1", type: "update", status: "failed", phase: "building", error: "npm ci failed", errorCode: null }),
      "GET /envs/env-1": () => ({ ...ENVIRONMENT, status: "failed" }),
      "GET /jobs/job-1/logs": () => new Response("step 1\nnpm ERR! missing script: build\n"),
    });
    const result = (await client.callTool({ name: "spawner_up", arguments: {} })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("failed during building: npm ci failed");
    expect(text(result)).toContain("npm ERR! missing script: build");
  });

  it("runs commands and reads errors", async () => {
    const calls: FakeRequest[] = [];
    const { client } = await connect(
      {
        "POST /envs/env-1/exec": () => ({ exitCode: 0, stdout: "1\n", stderr: "", truncated: false, timedOut: false }),
        "GET /envs/env-1/logs": () => ({ lines: [{ service: "app", stream: "stderr", time: "t", text: "TypeError: boom" }] }),
      },
      calls,
    );
    const exec = (await client.callTool({ name: "spawner_exec", arguments: { service: "db", command: ["psql", "-c", "select 1"] } })) as CallToolResult;
    expect(JSON.parse(text(exec))).toMatchObject({ exitCode: 0, stdout: "1\n" });
    const logs = (await client.callTool({ name: "spawner_logs", arguments: { errors_only: true } })) as CallToolResult;
    expect(text(logs)).toBe("app | TypeError: boom");
    expect(calls.at(-1)?.query.get("errors")).toBe("true");
  });

  it("turns API errors into tool errors with their hint", async () => {
    const { client } = await connect({ "POST /envs/env-1/exec": () => reply(403, { message: "only the owner of the environment or an admin can do this" }) });
    const result = (await client.callTool({ name: "spawner_exec", arguments: { env: "feat-login", service: "db", command: ["true"] } })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("error (forbidden): only the owner of the environment or an admin can do this");
  });
});
