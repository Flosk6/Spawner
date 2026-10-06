import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { GitKeysService } from "./git-keys.service";
import { GitMirrorService } from "./git-mirror.service";
import type { SpawnerConfig } from "./spawner.config";
import { StorageService } from "./storage.service";

describe("GitMirrorService", () => {
  let root: string;
  let repoUrl: string;
  let mainCommit: string;
  let featureCommit: string;
  let service: GitMirrorService;

  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
    })
      .toString()
      .trim();

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "spawner-git-"));
    const origin = path.join(root, "origin");
    fs.mkdirSync(origin);
    git(origin, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(origin, "README.md"), "main\n");
    git(origin, "add", ".");
    git(origin, "commit", "-q", "-m", "main");
    mainCommit = git(origin, "rev-parse", "HEAD");
    git(origin, "checkout", "-q", "-b", "feat/login");
    fs.writeFileSync(path.join(origin, "README.md"), "feature\n");
    git(origin, "commit", "-q", "-am", "feature");
    featureCommit = git(origin, "rev-parse", "HEAD");
    git(origin, "checkout", "-q", "main");
    repoUrl = `file://${origin}`;

    const config = { dataDir: path.join(root, "data"), keysDir: path.join(root, "data", "keys"), allowLocalRepos: true } as SpawnerConfig;
    const storage = new StorageService(config);
    storage.onModuleInit();
    const keys = { keyPathFor: () => null, knownHostsPath: path.join(root, "known_hosts") } as unknown as GitKeysService;
    service = new GitMirrorService(config, storage, keys);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("checks out two branches of the same repository in parallel without mixing them", async () => {
    const a = path.join(root, "envs", "a", "src", "app");
    const b = path.join(root, "envs", "b", "src", "app");

    const [first, second] = await Promise.all([
      service.checkout(repoUrl, "main", a, () => undefined),
      service.checkout(repoUrl, "feat/login", b, () => undefined),
    ]);

    expect(first.commit).toBe(mainCommit);
    expect(second.commit).toBe(featureCommit);
    expect(fs.readFileSync(path.join(a, "README.md"), "utf8")).toBe("main\n");
    expect(fs.readFileSync(path.join(b, "README.md"), "utf8")).toBe("feature\n");
  });

  it("moves an existing worktree to another ref", async () => {
    const target = path.join(root, "envs", "c", "src", "app");
    await service.checkout(repoUrl, "main", target, () => undefined);
    const { commit } = await service.checkout(repoUrl, featureCommit, target, () => undefined);

    expect(commit).toBe(featureCommit);
    expect(fs.readFileSync(path.join(target, "README.md"), "utf8")).toBe("feature\n");
  });

  it("explains an unknown ref", async () => {
    await expect(service.checkout(repoUrl, "does-not-exist", path.join(root, "envs", "d"), () => undefined)).rejects.toThrow(
      /"does-not-exist" is not a branch, tag or commit/,
    );
  });

  it("refuses refs that could be read as options", async () => {
    await expect(service.checkout(repoUrl, "--upload-pack=touch /tmp/x", path.join(root, "envs", "e"), () => undefined)).rejects.toThrow();
  });

  it("removes a worktree", async () => {
    const target = path.join(root, "envs", "f", "src", "app");
    await service.checkout(repoUrl, "main", target, () => undefined);
    await service.removeWorktree(repoUrl, target);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("lists branches", async () => {
    expect(await service.listBranches(repoUrl)).toEqual(["feat/login", "main"]);
  });

  it("rejects file:// repositories unless allowed", () => {
    const strict = new GitMirrorService({ allowLocalRepos: false } as SpawnerConfig, {} as StorageService, {} as GitKeysService);
    expect(() => strict.validateRepoUrl(repoUrl)).toThrow();
    expect(strict.validateRepoUrl("git@github.com:acme/app.git")).toBe("git@github.com:acme/app.git");
  });
});
