import { PassThrough } from "stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli, type Io } from "./cli";
import { EXIT } from "./errors";
import { fakeFetch, INFO, reply, SERVER, type FakeRequest } from "./testing/fake-api";
import { COMPOSE, git, MANIFEST, repo, tempDir } from "./testing/repo";

const ENVIRONMENT = {
  id: "env-1",
  project: "blog",
  slug: "feat-login",
  status: "ready",
  createdVia: "cli",
  owner: { id: 1, name: "Ada" },
  tokenName: "claude-laptop",
  exposures: [{ name: "web", service: "app", port: 3000, host: "feat-login--blog.localtest.me", entrypoint: true, auth: "team" }],
  urls: { web: "http://feat-login--blog.localtest.me" },
  url: "http://feat-login--blog.localtest.me",
  sources: [{ name: "app", primary: true, origin: "upload", sizeBytes: 2048, digest: "abcdef0123", ref: null, commit: null }],
  lastJob: null,
  expiresAt: null,
};

function io(env: NodeJS.ProcessEnv = {}, cwd = tempDir()) {
  let stdout = "";
  let stderr = "";
  const out = new PassThrough();
  const err = new PassThrough();
  out.on("data", (chunk) => (stdout += chunk));
  err.on("data", (chunk) => (stderr += chunk));
  const streams: Io = {
    stdout: out as unknown as NodeJS.WriteStream,
    stderr: err as unknown as NodeJS.WriteStream,
    stdin: new PassThrough() as unknown as NodeJS.ReadStream,
    env: { SPAWNER_CONFIG_DIR: tempDir(), ...env },
    cwd,
  };
  return { streams, output: () => ({ stdout, stderr }) };
}

const LOGGED_IN = { SPAWNER_URL: SERVER, SPAWNER_TOKEN: "spn_test0000_secret" };

describe("spawner", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prints its help and version", async () => {
    const { streams, output } = io();
    expect(await runCli(["--help"], streams)).toBe(EXIT.ok);
    expect(output().stdout).toContain("Exit codes: 0 ok");
    expect(await runCli(["--version"], streams)).toBe(EXIT.ok);
  });

  it("exits with 2 on a usage error, in JSON too", async () => {
    const { streams, output } = io();
    expect(await runCli(["nope", "--json"], streams)).toBe(EXIT.usage);
    expect(JSON.parse(output().stdout)).toMatchObject({ error: { code: "usage" } });
  });

  it("tells to put the command of exec after --", async () => {
    const { streams, output } = io(LOGGED_IN);
    expect(await runCli(["exec", "feat-login", "db", "psql", "-c", "select 1"], streams)).toBe(EXIT.usage);
    expect(output().stderr).toContain("Put the command after --");
  });

  it("exits with 3 when not logged in, with the command to run", async () => {
    const { streams, output } = io({}, repo({ ".spawner/spawner.yaml": "project: blog\n" }));
    expect(await runCli(["status", "feat-login"], streams)).toBe(EXIT.auth);
    expect(output().stderr).toContain("spawner login");
    expect(await runCli(["status", "feat-login", "--json"], streams)).toBe(EXIT.auth);
    expect(JSON.parse(output().stdout)).toMatchObject({ error: { code: "not_logged_in" } });
  });

  it("logs in with a code to type in the dashboard, never a link that carries it", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        "GET /healthz": () => ({ status: "ok" }),
        "POST /auth/device": () => ({
          deviceCode: "device",
          userCode: "BCDF-GHJK",
          verificationUri: `${SERVER}/device`,
          verificationUriComplete: `${SERVER}/device?code=BCDF-GHJK`,
          expiresIn: 600,
          interval: 0.001,
        }),
        "POST /auth/device/token": () => ({ token: "spn_abcdefgh_secret", id: "t1", name: "laptop", scopes: ["envs:read"], expiresAt: null, user: { id: 1, name: "Ada", role: "admin" } }),
      }),
    );
    const { streams, output } = io();
    expect(await runCli(["login", SERVER, "--no-browser"], streams)).toBe(EXIT.ok);
    expect(output().stderr).toContain(`Open ${SERVER}/device\nand enter the code BCDF-GHJK (it expires in 10 minutes).\n`);
    expect(output().stderr).not.toContain("?code=");
    expect(`${output().stderr}${output().stdout}`.match(/[A-Z]{4}-[A-Z]{4}/g)).toEqual(["BCDF-GHJK"]);
    expect(output().stdout).toContain(`Logged in to ${SERVER} as Ada (admin).`);
  });

  it("lists the environments of the project of the directory", async () => {
    const calls: FakeRequest[] = [];
    vi.stubGlobal("fetch", fakeFetch({ "GET /envs": () => [ENVIRONMENT] }, calls));
    const { streams, output } = io(LOGGED_IN, repo({ ".spawner/spawner.yaml": "project: blog\n" }));
    expect(await runCli(["ls"], streams)).toBe(EXIT.ok);
    expect(calls[0].query.get("project")).toBe("blog");
    expect(output().stdout).toMatch(/feat-login\s+ready\s+Ada via claude-laptop \(cli\)\s+http:\/\/feat-login--blog\.localtest\.me/);
  });

  it("prints a URL alone, for $(spawner url)", async () => {
    vi.stubGlobal("fetch", fakeFetch({ "GET /envs": () => [ENVIRONMENT] }));
    const { streams, output } = io(LOGGED_IN);
    expect(await runCli(["url", "feat-login", "--project", "blog"], streams)).toBe(EXIT.ok);
    expect(output().stdout).toBe("http://feat-login--blog.localtest.me\n");
  });

  it("exits with the exit code of the command it ran", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        "GET /info": () => INFO,
        "GET /envs": () => [ENVIRONMENT],
        "POST /envs/env-1/exec": () => ({ exitCode: 42, stdout: "out\n", stderr: "err\n", truncated: false, timedOut: false }),
      }),
    );
    const { streams, output } = io(LOGGED_IN);
    expect(await runCli(["exec", "feat-login", "app", "--project", "blog", "--", "sh", "-c", "exit 42"], streams)).toBe(42);
    expect(output()).toEqual({ stdout: "out\n", stderr: "err\n" });
  });

  it("creates an environment and prints its URLs, progress on stderr", async () => {
    const cwd = repo({ ".spawner/spawner.yaml": MANIFEST.replace("example", "blog"), ".spawner/compose.yaml": COMPOSE, Dockerfile: "FROM node:22" });
    git(cwd, "checkout", "-q", "-b", "feat/login");
    let polls = 0;
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        "GET /info": () => INFO,
        "GET /projects/blog": () => ({ slug: "blog", rootDir: "." }),
        "GET /envs": () => reply(404, { message: "not found" }),
        "POST /envs": () => ({ environment: { ...ENVIRONMENT, status: "queued" }, job: { id: "job-1", environmentId: "env-1", type: "create", status: "queued" } }),
        "GET /jobs/job-1": () => ({ id: "job-1", environmentId: "env-1", type: "create", status: ++polls > 1 ? "succeeded" : "running" }),
        "GET /envs/env-1": () => ({ ...ENVIRONMENT, status: polls > 1 ? "ready" : "building", expiresAt: new Date(Date.now() + 48 * 3600_000 + 60_000).toISOString() }),
      }),
    );
    const { streams, output } = io(LOGGED_IN, cwd);
    expect(await runCli(["up", "--wait"], streams)).toBe(EXIT.ok);
    expect(output().stdout).toBe(
      [
        "feat-login (blog) is ready",
        "  web  http://feat-login--blog.localtest.me",
        "Expires in 48h. The URLs need a login; for curl or tests: spawner url feat-login --with-token",
        "",
      ].join("\n"),
    );
    expect(output().stderr).toMatch(/^Packing app: 3 files, .*\nCreating feat-login in blog\nJob job-1 queued\nbuilding\.\.\.\nReady in \d+s\n$/);
  });

  it("prints the end of the log of a failed job on stderr, with exit code 4", async () => {
    const cwd = repo({ ".spawner/spawner.yaml": MANIFEST.replace("example", "blog"), ".spawner/compose.yaml": COMPOSE, Dockerfile: "FROM node:22" });
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        "GET /info": () => INFO,
        "GET /projects/blog": () => ({ slug: "blog", rootDir: "." }),
        "GET /envs": () => [ENVIRONMENT],
        "POST /envs/env-1/update": () => ({ environment: ENVIRONMENT, job: { id: "job-1", environmentId: "env-1", type: "update", status: "queued" } }),
        "GET /jobs/job-1": () => ({ id: "job-1", environmentId: "env-1", type: "update", status: "failed", phase: "building", error: "exit status 1", errorCode: null }),
        "GET /envs/env-1": () => ({ ...ENVIRONMENT, status: "failed" }),
        "GET /jobs/job-1/logs": () => new Response("npm ERR! missing script: start\n"),
      }),
    );
    const { streams, output } = io(LOGGED_IN, cwd);
    expect(await runCli(["up", "feat-login", "--wait", "--json"], streams)).toBe(EXIT.failed);
    expect(JSON.parse(output().stdout)).toMatchObject({ action: "updated", job: { status: "failed" }, logTail: ["npm ERR! missing script: start"] });
    expect(output().stderr).toContain("npm ERR! missing script: start");
  });

  it("shows an environment and its services", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        "GET /envs": () => [ENVIRONMENT],
        "GET /envs/env-1/services": () => [{ name: "app", state: "running", status: "Up", health: "healthy", restartCount: 2, oomKilled: true, exitCode: null }],
      }),
    );
    const { streams, output } = io(LOGGED_IN);
    expect(await runCli(["status", "feat-login", "-p", "blog"], streams)).toBe(EXIT.ok);
    expect(output().stdout).toContain("Ada via claude-laptop (cli)");
    expect(output().stdout).toMatch(/app\s+running\s+healthy\s+2\s+yes/);
  });
});
