import { BadRequestException, ConflictException } from "@nestjs/common";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionActor } from "../../common/actor";
import type { DockerService } from "../../common/docker.service";
import type { PrismaService } from "../../common/prisma.service";
import type { SpawnerConfig } from "../../common/spawner.config";
import { SPAWNER_VERSION } from "../../common/version";
import type { AuditService } from "../audit/audit.service";
import type { UpdateRun } from "./releases";
import { UpdatesService } from "./updates.service";

const admin = sessionActor({ id: 1, name: "Ada", role: "admin" });
const next = "99.0.0";

describe("UpdatesService", () => {
  let dir: string;
  let settings: Map<string, string>;
  let runningJobs: number;
  let self: Record<string, any> | null;
  let helper: { State: { Running: boolean; ExitCode: number } } | null;
  let created: Record<string, any>[];
  let audit: { record: ReturnType<typeof vi.fn> };
  let service: UpdatesService;

  const docker = () =>
    ({
      self: async () => self,
      pullImage: vi.fn(async () => undefined),
      removeContainer: vi.fn(async () => undefined),
      tail: async () => ["== Upgrading", "error: Spawner did not start"],
      client: {
        createContainer: async (spec: Record<string, any>) => {
          created.push(spec);
          return { start: async () => (helper = { State: { Running: true, ExitCode: 0 } }) };
        },
        getContainer: () => ({ inspect: async () => helper ?? Promise.reject(new Error("no such container")) }),
      },
    }) as unknown as DockerService;
  const prisma = () =>
    ({
      setting: {
        findUnique: async ({ where }: { where: { key: string } }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
        upsert: async ({ where, create }: { where: { key: string }; create: { value: string } }) => settings.set(where.key, create.value),
      },
      job: { count: async () => runningJobs },
    }) as unknown as PrismaService;
  const make = () =>
    new UpdatesService(
      prisma(),
      docker(),
      { updateCheck: true, releasesUrl: `file://${path.join(dir, "releases.json")}`, dataDir: "/var/lib/spawner" } as unknown as SpawnerConfig,
      audit as unknown as AuditService,
    );
  const releases = (...tags: string[]) =>
    fs.writeFileSync(path.join(dir, "releases.json"), JSON.stringify(tags.map((tag) => ({ tag_name: tag, html_url: `https://example.test/${tag}`, prerelease: tag.includes("-") }))));
  const storeRun = (run: Partial<UpdateRun>) =>
    settings.set(
      "update.run",
      JSON.stringify({ from: SPAWNER_VERSION, to: next, by: "Ada", startedAt: new Date().toISOString(), finishedAt: null, state: "running", phase: "installing", error: null, log: [], ...run }),
    );

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "spawner-updates-"));
    settings = new Map();
    runningJobs = 0;
    helper = null;
    created = [];
    audit = { record: vi.fn(async () => undefined) };
    self = {
      Config: {
        Image: `ghcr.io/flosk6/spawner:${SPAWNER_VERSION}`,
        Labels: { "com.docker.compose.project": "spawner", "com.docker.compose.project.working_dir": "/opt/spawner" },
      },
      Mounts: [{ Source: "/run/docker.sock", Destination: "/var/run/docker.sock" }],
    };
    releases(`v${next}`, "v0.0.1");
    service = make();
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("finds the newest version, and whether this server can update itself", async () => {
    await service.check();
    expect(await service.status()).toMatchObject({ current: SPAWNER_VERSION, managed: true, reason: null, latest: { version: next, url: `https://example.test/v${next}` } });

    self!.Config.Image = "spawner-spawner:latest";
    expect(await service.status()).toMatchObject({ managed: false, reason: expect.stringContaining("not installed by install.sh") });
    self = null;
    expect(await service.status()).toMatchObject({ managed: false, reason: expect.stringContaining("does not run in a container") });
  });

  it("starts the installer of the new version in a container, after downloading it", async () => {
    const run = await service.start(admin);
    expect(run).toMatchObject({ from: SPAWNER_VERSION, to: next, by: "Ada", state: "running", phase: "downloading" });
    await vi.waitFor(() => expect(helper?.State.Running).toBe(true));
    expect(created[0]).toMatchObject({
      name: "spawner-upgrade",
      Image: `ghcr.io/flosk6/spawner:${next}`,
      Cmd: ["--upgrade", "--version", next, "--image", `ghcr.io/flosk6/spawner:${next}`, "--yes"],
      HostConfig: { Binds: ["/run/docker.sock:/var/run/docker.sock", "/opt/spawner:/opt/spawner", "/var/lib/spawner:/var/lib/spawner"] },
    });
    expect(JSON.parse(settings.get("update.run")!)).toMatchObject({ phase: "installing", state: "running" });
    expect(audit.record).toHaveBeenCalledWith(admin, "system.update", expect.objectContaining({ target: next }));
    await expect(service.start(admin)).rejects.toThrow(ConflictException);
  });

  it("refuses while jobs run, when there is nothing newer, or when it was not installed by install.sh", async () => {
    runningJobs = 2;
    await expect(service.start(admin)).rejects.toThrow("2 jobs are running");
    runningJobs = 0;
    releases("v0.0.1");
    await expect(service.start(admin)).rejects.toThrow("Spawner is up to date");
    self = null;
    await expect(service.start(admin)).rejects.toThrow(BadRequestException);
    expect(created).toEqual([]);
  });

  it("says the update went back to the previous version, with the installer's output", async () => {
    storeRun({});
    helper = { State: { Running: true, ExitCode: 0 } };
    expect((await service.status()).run).toMatchObject({ state: "running" });

    helper = { State: { Running: false, ExitCode: 1 } };
    const { run } = await service.status();
    expect(run).toMatchObject({ state: "failed", error: expect.stringContaining("went back to the previous one"), log: ["== Upgrading", "error: Spawner did not start"] });
    expect(audit.record).toHaveBeenCalledWith(null, "system.update.failed", expect.objectContaining({ target: next }));
    expect((await service.status()).run?.state).toBe("failed");
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it("says the update succeeded once Spawner runs the new version", async () => {
    storeRun({ from: "0.9.0", to: SPAWNER_VERSION });
    helper = { State: { Running: false, ExitCode: 0 } };
    expect((await service.status()).run).toMatchObject({ state: "succeeded", error: null, finishedAt: expect.any(String) });
    expect(audit.record).toHaveBeenCalledWith(null, "system.update.succeeded", expect.objectContaining({ target: SPAWNER_VERSION }));
  });

  it("says a download cut short by a restart failed", async () => {
    storeRun({ phase: "downloading", startedAt: new Date(Date.now() - 3600_000).toISOString() });
    expect((await service.status()).run).toMatchObject({ state: "failed", error: expect.stringContaining("restarted while it downloaded") });
  });
});
