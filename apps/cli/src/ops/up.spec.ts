import * as fs from "fs";
import * as path from "path";
import { list } from "tar";
import { beforeEach, describe, expect, it } from "vitest";
import { EXIT } from "../errors";
import { fakeContext, fakeFetch, INFO, reply, type FakeRequest } from "../testing/fake-api";
import { COMPOSE, git, MANIFEST, repo, tempDir, write } from "../testing/repo";
import { jobExitCode, up } from "./up";

const PROJECT = { slug: "example", rootDir: ".", repoUrl: "git@github.com:acme/example.git", defaultRef: "main" };

function environment(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: "env-1",
    project: "example",
    slug: "feat-login",
    status,
    exposures: [{ name: "web", service: "app", port: 3000, host: "feat-login--example.localtest.me", entrypoint: true, auth: "team" }],
    urls: { web: "http://feat-login--example.localtest.me" },
    url: "http://feat-login--example.localtest.me",
    ...extra,
  };
}

function job(status: string, extra: Record<string, unknown> = {}) {
  return { id: "job-1", environmentId: "env-1", type: "create", status, phase: null, error: null, errorCode: null, ...extra };
}

async function archiveEntries(form: FormData, field: string): Promise<string[]> {
  const blob = form.get(field) as Blob;
  const file = path.join(tempDir(), "archive.tar.gz");
  fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  const entries: string[] = [];
  await list({ file, onReadEntry: (entry) => entries.push(entry.path) });
  return entries.sort();
}

describe("up", () => {
  let root: string;
  let calls: FakeRequest[];
  let jobs: string[];

  beforeEach(() => {
    root = repo({ ".spawner/spawner.yaml": MANIFEST, ".spawner/compose.yaml": COMPOSE, "server.js": "x", Dockerfile: "FROM node:22" });
    git(root, "checkout", "-q", "-b", "feat/login");
    write(root, "uncommitted.js", "work in progress");
    calls = [];
    jobs = ["running", "running", "succeeded"];
  });

  const routes = (overrides: Record<string, (request: FakeRequest) => unknown> = {}) =>
    fakeFetch(
      {
        "GET /info": () => INFO,
        "GET /projects/example": () => PROJECT,
        "GET /envs": () => reply(404, { message: "not found" }),
        "POST /envs": () => ({ environment: environment("queued"), job: job("queued") }),
        "GET /jobs/job-1": () => job(jobs.shift() ?? "succeeded"),
        "GET /envs/env-1": () => environment(jobs.length ? "building" : "ready", { expiresAt: "2026-10-10T10:00:00Z" }),
        ...overrides,
      },
      calls,
    );

  it("creates the environment of the branch from the worktree, uncommitted work included", async () => {
    const progress: string[] = [];
    const result = await up(fakeContext(root, routes()), { wait: true, ttl: "24h", onProgress: (message) => progress.push(message) });

    expect(result).toMatchObject({ action: "created", waited: true, timedOut: false, environment: { status: "ready" }, job: { status: "succeeded" } });
    expect(jobExitCode(result)).toBe(EXIT.ok);
    const create = calls.find((call) => call.method === "POST" && call.path === "/envs")!;
    expect(Object.fromEntries([...create.form!.entries()].filter(([, value]) => typeof value === "string"))).toEqual({
      project: "example",
      env: "feat-login",
      createdVia: "cli",
      ttl: "86400s",
    });
    expect(await archiveEntries(create.form!, "primary")).toEqual([".spawner/compose.yaml", ".spawner/spawner.yaml", "Dockerfile", "server.js", "uncommitted.js"]);
    expect(result.uploads).toEqual([expect.objectContaining({ source: "app", files: 5 })]);
    expect(progress).toEqual(expect.arrayContaining(["Creating feat-login in example", "building...", expect.stringMatching(/^Ready in/)]));
  });

  it("updates an existing environment, with fresh and reseed", async () => {
    const result = await up(
      fakeContext(root, routes({ "GET /envs": () => [environment("ready")], "POST /envs/env-1/update": () => ({ environment: environment("queued"), job: job("queued", { type: "update" }) }) })),
      { env: "feat-login", fresh: true, reseed: true },
    );
    expect(result).toMatchObject({ action: "updated", waited: false });
    const update = calls.find((call) => call.path === "/envs/env-1/update")!;
    expect(update.form?.get("fresh")).toBe("true");
    expect(update.form?.get("reseed")).toBe("true");
    expect(update.form?.get("project")).toBeNull();
  });

  it("refuses a compose file locally, without sending anything (exit 7)", async () => {
    fs.writeFileSync(path.join(root, ".spawner/compose.yaml"), COMPOSE.replace("    build: ..\n", "    build: ..\n    network_mode: host\n"));
    await expect(up(fakeContext(root, routes()), {})).rejects.toMatchObject({ exit: EXIT.refused, code: "refused" });
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("checks that spawner.yaml sits where the project expects it", async () => {
    await expect(up(fakeContext(root, routes({ "GET /projects/example": () => ({ ...PROJECT, rootDir: "apps/api" }) })), {})).rejects.toMatchObject({
      exit: EXIT.usage,
      message: expect.stringContaining("expects it in apps/api"),
    });
  });

  it("deploys the project from git with --ref, and other sources from local worktrees", async () => {
    fs.writeFileSync(path.join(root, ".spawner/spawner.yaml"), `${MANIFEST}sources:\n  front:\n    repo: git@github.com:acme/front.git\n`);
    const front = repo({ "index.html": "front" });
    write(front, "node_modules/x.js", "installed, untracked");
    await up(fakeContext(root, routes()), { refs: { app: "main" }, sources: { front } });
    const create = calls.find((call) => call.method === "POST" && call.path === "/envs")!;
    expect(create.form?.get("primary")).toBe('{"ref":"main"}');
    expect(await archiveEntries(create.form!, "source:front")).toEqual(["index.html"]);
  });

  it("refuses sources spawner.yaml does not declare", async () => {
    await expect(up(fakeContext(root, routes()), { sources: { admin: root } })).rejects.toMatchObject({ exit: EXIT.usage });
  });

  it.each([
    [null, EXIT.failed],
    ["capacity", EXIT.capacity],
    ["invalid", EXIT.refused],
  ])("returns the end of the log of a failed job (error code %s, exit %d)", async (errorCode, exit) => {
    jobs = ["failed"];
    const result = await up(
      fakeContext(
        root,
        routes({
          "GET /jobs/job-1": () => job("failed", { phase: "building", error: "build failed", errorCode }),
          "GET /envs/env-1": () => environment("failed"),
          "GET /jobs/job-1/logs": () => new Response(Array.from({ length: 60 }, (_, index) => `line ${index}`).join("\n")),
        }),
      ),
      { wait: true },
    );
    expect(jobExitCode(result)).toBe(exit);
    expect(result.logTail).toHaveLength(40);
    expect(result.logTail?.at(-1)).toBe("line 59");
  });

  it("gives up waiting after the timeout (exit 5), the job going on", async () => {
    jobs = Array(10).fill("running");
    const result = await up(fakeContext(root, routes()), { wait: true, timeoutSec: 0.001 });
    expect(result.timedOut).toBe(true);
    expect(jobExitCode(result)).toBe(EXIT.timeout);
  });
});
