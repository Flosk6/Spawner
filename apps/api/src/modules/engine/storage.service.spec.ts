import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DockerService } from "../../common/docker.service";
import type { SpawnerConfig } from "../../common/spawner.config";
import { StorageService } from "./storage.service";

const config = { dataDir: "/unused", keysDir: "/unused/keys" } as SpawnerConfig;

describe("StorageService.removeTree", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "spawner-storage-"));
  });

  afterEach(() => {
    fs.chmodSync(root, 0o700);
    for (const dir of fs.readdirSync(root, { recursive: true }) as string[]) {
      fs.chmodSync(path.join(root, dir), 0o700);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** A source where a container wrote, as another user, a directory Spawner cannot empty. */
  function lockedSource(): string {
    const source = path.join(root, "src", "app");
    fs.mkdirSync(path.join(source, "storage"), { recursive: true });
    fs.writeFileSync(path.join(source, "storage", "laravel.log"), "written by the container");
    fs.chmodSync(path.join(source, "storage"), 0o555);
    return source;
  }

  it("removes a directory it owns without Docker", async () => {
    const dir = path.join(root, "plain");
    fs.mkdirSync(path.join(dir, "a"), { recursive: true });
    fs.writeFileSync(path.join(dir, "a", "file"), "x");

    await new StorageService(config).removeTree(dir);

    expect(fs.existsSync(dir)).toBe(false);
  });

  it.skipIf(process.getuid?.() === 0)("hands what it cannot delete to Docker, as root", async () => {
    const source = lockedSource();
    const removedAsRoot: string[] = [];
    const docker = {
      removeAsRoot: async (dir: string) => {
        removedAsRoot.push(dir);
        fs.chmodSync(path.join(dir, "storage"), 0o755);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    } as unknown as DockerService;

    await new StorageService(config, docker).removeTree(source);

    expect(removedAsRoot).toEqual([source]);
    expect(fs.existsSync(source)).toBe(false);
  });

  it.skipIf(process.getuid?.() === 0)("reports the error when Docker is not available", async () => {
    await expect(new StorageService(config).removeTree(lockedSource())).rejects.toMatchObject({ code: expect.stringMatching(/EACCES|EPERM/) });
  });
});

describe("StorageService.writeAtomic", () => {
  it("writes files Spawner alone reads, unless a mode says otherwise", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "spawner-atomic-"));
    const storage = new StorageService(config);
    storage.writeAtomic(path.join(root, "compose.rendered.yaml"), "secret: x\n");
    storage.writeAtomic(path.join(root, "routes.yaml"), "http: {}\n", 0o644);
    expect(fs.statSync(path.join(root, "compose.rendered.yaml")).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.join(root, "routes.yaml")).mode & 0o777).toBe(0o644);
    expect(fs.readdirSync(root).sort()).toEqual(["compose.rendered.yaml", "routes.yaml"]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
