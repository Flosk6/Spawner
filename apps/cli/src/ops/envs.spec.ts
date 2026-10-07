import { describe, expect, it } from "vitest";
import { EXIT } from "../errors";
import { events, fakeContext, fakeFetch, INFO, reply, type FakeRequest } from "../testing/fake-api";
import { repo } from "../testing/repo";
import { capacity, lifecycle, share, status, url } from "./envs";
import { exec } from "./exec";
import { followLogs, readLogs, sinceDate } from "./logs";

const ENVIRONMENT = {
  id: "env-1",
  project: "blog",
  slug: "feat-login",
  status: "ready",
  exposures: [
    { name: "web", service: "front", port: 3000, host: "feat-login--blog.localtest.me", entrypoint: true, auth: "team" },
    { name: "api", service: "api", port: 8000, host: "api--feat-login--blog.localtest.me", entrypoint: false, auth: "team" },
  ],
  urls: { web: "http://feat-login--blog.localtest.me", api: "http://api--feat-login--blog.localtest.me" },
  lastJob: { id: "job-1" },
};

function context(routes: Record<string, (request: FakeRequest) => unknown>, calls: FakeRequest[] = []) {
  const cwd = repo({ ".spawner/spawner.yaml": "version: 1\nproject: blog\n" });
  return fakeContext(cwd, fakeFetch({ "GET /info": () => INFO, "GET /envs": () => [ENVIRONMENT], ...routes }, calls));
}

describe("environment operations", () => {
  it("finds the environment by project and name, the project from spawner.yaml", async () => {
    const calls: FakeRequest[] = [];
    const result = await status(context({ "GET /envs/env-1/services": () => [{ name: "api", state: "running" }] }, calls), { env: "feat-login" });
    expect(calls[0].query.toString()).toBe("project=blog&slug=feat-login");
    expect(result.services).toEqual([{ name: "api", state: "running" }]);
  });

  it("adds the last events and the crash loops of the timeline", async () => {
    const ctx = context({
      "GET /envs/env-1/services": () => [],
      "GET /envs/env-1/events": () => ({
        events: [{ id: "2", time: "2026-10-07T10:00:00Z", type: "oom", service: "api", message: "api ran out of memory (limit 512 MiB)", details: null }],
        crashLoops: [{ service: "api", count: 3, windowMinutes: 10, lastCause: "out of memory (limit 512 MiB)", lastAt: "2026-10-07T10:00:00Z" }],
      }),
    });
    const result = await status(ctx, { env: "feat-login" });
    expect(result.events[0].type).toBe("oom");
    expect(result.crashLoops[0].lastCause).toBe("out of memory (limit 512 MiB)");
  });

  it("gives the room left for each project, or one", async () => {
    const ctx = context({
      "GET /system/capacity": () => ({
        host: null,
        projects: [
          { project: "blog", places: 3 },
          { project: "shop", places: 0 },
        ],
      }),
    });
    expect((await capacity(ctx, {})).projects).toHaveLength(2);
    expect((await capacity(ctx, { project: "shop" })).projects).toEqual([{ project: "shop", places: 0 }]);
  });

  it("explains an unknown environment", async () => {
    await expect(status(context({ "GET /envs": () => reply(404, { message: "nope" }) }), { env: "other" })).rejects.toMatchObject({
      code: "not_found",
      hint: expect.stringContaining("spawner ls --project blog"),
    });
  });

  it("gives the entrypoint URL, or an exposure's, with the preview header", async () => {
    const ctx = context({ "POST /envs/env-1/preview-token": () => ({ header: "X-Spawner-Preview", token: "signed", expiresAt: "2026-10-07T12:00:00Z" }) });
    expect(await url(ctx, { env: "feat-login" })).toMatchObject({ exposure: "web", url: "http://feat-login--blog.localtest.me" });
    expect(await url(ctx, { env: "feat-login", exposure: "api", withToken: true })).toMatchObject({
      exposure: "api",
      url: "http://api--feat-login--blog.localtest.me",
      header: { name: "X-Spawner-Preview", value: "signed" },
    });
    await expect(url(ctx, { env: "feat-login", exposure: "admin" })).rejects.toMatchObject({ exit: EXIT.usage, hint: "its exposures: web, api" });
  });

  it("shares for whole hours only", async () => {
    const calls: FakeRequest[] = [];
    const ctx = context({ "POST /envs/env-1/share": () => ({ id: "s1", url: "http://x/?__spawner_share=t", expiresAt: "2026-10-10T00:00:00Z" }) }, calls);
    expect(await share(ctx, { env: "feat-login", ttl: "3d" })).toMatchObject({ url: "http://x/?__spawner_share=t" });
    expect(calls.at(-1)?.json).toEqual({ ttlHours: 72 });
    await expect(share(ctx, { env: "feat-login", ttl: "90m" })).rejects.toMatchObject({ exit: EXIT.usage });
  });

  it("deletes and waits until the environment is gone", async () => {
    let polls = 0;
    const ctx = context({
      "DELETE /envs/env-1": () => ({ environment: { ...ENVIRONMENT, status: "deleting" }, job: { id: "job-2", environmentId: "env-1", type: "delete", status: "queued" } }),
      "GET /jobs/job-2": () => ({ id: "job-2", environmentId: "env-1", type: "delete", status: ++polls > 1 ? "succeeded" : "running" }),
      "GET /envs/env-1": () => (polls > 1 ? reply(404, { message: "gone" }) : { ...ENVIRONMENT, status: "deleting" }),
    });
    const result = await lifecycle(ctx, "down", { env: "feat-login", wait: true });
    expect(result).toMatchObject({ waited: true, job: { status: "succeeded" }, environment: { status: "deleted" } });
  });

  it("runs a command with its standard input in base64", async () => {
    const calls: FakeRequest[] = [];
    const ctx = context({ "POST /envs/env-1/exec": () => ({ exitCode: 3, stdout: "out", stderr: "err", truncated: false, timedOut: false }) }, calls);
    const result = await exec(ctx, { env: "feat-login", service: "db", argv: ["psql", "-f", "-"], stdin: Buffer.from("select 1;") });
    expect(result).toMatchObject({ exitCode: 3, stdout: "out", env: "feat-login", service: "db" });
    expect(calls.at(-1)?.json).toEqual({ service: "db", argv: ["psql", "-f", "-"], stdin: Buffer.from("select 1;").toString("base64") });
    await expect(exec(ctx, { env: "feat-login", service: "db", argv: [] })).rejects.toMatchObject({ exit: EXIT.usage });
  });

  it("wakes a sleeping environment up before running a command", async () => {
    const calls: FakeRequest[] = [];
    const ctx = context(
      {
        "GET /envs": () => [{ ...ENVIRONMENT, status: "sleeping" }],
        "POST /envs/env-1/wake": () => ({ environment: { ...ENVIRONMENT, status: "waking" }, job: { id: "job-3", environmentId: "env-1", type: "wake", status: "queued" } }),
        "GET /jobs/job-3": () => ({ id: "job-3", environmentId: "env-1", type: "wake", status: "succeeded" }),
        "GET /envs/env-1": () => ({ ...ENVIRONMENT, status: "ready" }),
        "POST /envs/env-1/exec": () => ({ exitCode: 0, stdout: "1", stderr: "", truncated: false, timedOut: false }),
      },
      calls,
    );
    const progress: string[] = [];
    const result = await exec(ctx, { env: "feat-login", service: "db", argv: ["true"], onProgress: (message) => progress.push(message) });
    expect(result.exitCode).toBe(0);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(expect.arrayContaining(["POST /envs/env-1/wake", "POST /envs/env-1/exec"]));
    expect(progress).toEqual(["feat-login is asleep: waking it up", expect.stringMatching(/^feat-login is awake \(\d+s\)$/)]);
  });

  it("does nothing to wake an environment already awake", async () => {
    const ctx = context({ "POST /envs/env-1/wake": () => ({ environment: ENVIRONMENT, job: null }) });
    expect(await lifecycle(ctx, "wake", { env: "feat-login", wait: true })).toMatchObject({ job: null, waited: false });
  });

  it("exits with 6 when the quota or the memory of the server refuses", async () => {
    const ctx = context({
      "POST /envs/env-1/start": () => reply(503, { statusCode: 503, code: "capacity", message: "Not enough memory on the server", hint: "put an environment to sleep" }),
    });
    await expect(lifecycle(ctx, "start", { env: "feat-login" })).rejects.toMatchObject({ exit: EXIT.capacity, code: "capacity", hint: "put an environment to sleep" });
  });

  it("explains a service that is not running", async () => {
    const ctx = context({ "POST /envs/env-1/exec": () => reply(409, { message: 'service "db" is not running' }) });
    await expect(exec(ctx, { env: "feat-login", service: "db", argv: ["true"] })).rejects.toMatchObject({ code: "not_running", hint: expect.stringContaining("spawner status") });
  });
});

describe("logs", () => {
  it("passes the filters to the API", async () => {
    const calls: FakeRequest[] = [];
    const ctx = context({ "GET /envs/env-1/logs": () => ({ lines: [{ service: "api", stream: "stderr", time: "t", text: "Error: x" }] }) }, calls);
    const { lines } = await readLogs(ctx, { env: "feat-login", services: ["api", "db"], tail: 50, grep: "x", errors: true });
    expect(lines).toHaveLength(1);
    expect(Object.fromEntries(calls.at(-1)!.query)).toEqual({ service: "api,db", tail: "50", grep: "x", errors: "true" });
  });

  it("follows until the stream ends", async () => {
    const ctx = context({
      "GET /envs/env-1/logs": () => events('data: {"service":"api","stream":"stdout","time":"t","text":"one"}\n\n: keep-alive\n\ndata: {"service":"api","stream":"stdout","time":"t","text":"two"}\n\nevent: end\ndata: {}\n\n'),
    });
    const texts: string[] = [];
    for await (const line of followLogs(ctx, ENVIRONMENT as never, {})) {
      texts.push(line.text);
    }
    expect(texts).toEqual(["one", "two"]);
  });

  it("reads --since as a duration or a date", () => {
    expect(sinceDate("10m", Date.parse("2026-10-07T10:00:00Z"))).toBe("2026-10-07T09:50:00.000Z");
    expect(sinceDate("2026-10-07T08:00:00Z")).toBe("2026-10-07T08:00:00.000Z");
    expect(() => sinceDate("yesterday")).toThrow();
  });
});
