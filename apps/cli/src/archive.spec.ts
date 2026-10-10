import * as fs from "fs";
import * as path from "path";
import { list } from "tar";
import { describe, expect, it } from "vitest";
import { checkSourceFiles, collectFiles, globToRegExp, globUnder, isExcludedByDefault, packFiles } from "./archive";
import { CliError } from "./errors";
import { git, repo, tempDir, write } from "./testing/repo";

const LIMITS = { maxFiles: 1000, maxExtractedBytes: 10 * 1024 * 1024 };

async function entries(archive: string): Promise<{ path: string; type: string; linkpath?: string }[]> {
  const found: { path: string; type: string; linkpath?: string }[] = [];
  await list({ file: archive, onReadEntry: (entry) => found.push({ path: entry.path, type: entry.type, linkpath: entry.linkpath || undefined }) });
  return found;
}

describe("globToRegExp", () => {
  it.each([
    [".env.preview", ".env.preview", true],
    [".env.preview", "sub/.env.preview", false],
    ["config/*.php", "config/local.php", true],
    ["config/*.php", "config/sub/local.php", false],
    ["**/*.pem", "certs/dev/key.pem", true],
    ["**/*.pem", "key.pem", true],
    ["storage/keys", "storage/keys/oauth.key", true],
    ["storage/keys/", "storage/keys", true],
  ])("%s on %s: %s", (pattern, file, expected) => {
    expect(globToRegExp(pattern).test(file)).toBe(expected);
  });
});

describe("isExcludedByDefault", () => {
  it("keeps dependencies and local secrets home", () => {
    expect(isExcludedByDefault("node_modules/x/index.js")).toBe(true);
    expect(isExcludedByDefault("api/vendor/autoload.php")).toBe(true);
    expect(isExcludedByDefault(".env")).toBe(true);
    expect(isExcludedByDefault("api/.env.local")).toBe(true);
    expect(isExcludedByDefault(".env.example")).toBe(true);
    for (const secret of [".env-staging", ".npmrc", "web/.yarnrc.yml", ".netrc", "keys/id_ed25519", "id_rsa", "certs/server.pem", "tls.key", "store.p12"]) {
      expect(isExcludedByDefault(secret)).toBe(true);
    }
    for (const kept of ["src/environment.ts", "keys/id_ed25519.pub", "docs/keys.md", "src/monkey.ts", "public/key.svg"]) {
      expect(isExcludedByDefault(kept)).toBe(false);
    }
  });
});

describe("collectFiles", () => {
  it("sends the worktree as git sees it, uncommitted work included", async () => {
    const root = repo({
      ".gitignore": "dist/\nsecret.key\n",
      "src/index.js": "console.log(1)",
      "removed.txt": "gone",
      ".env": "TRACKED=1",
    });
    write(root, "src/new.js", "uncommitted");
    write(root, "dist/bundle.js", "ignored");
    write(root, "secret.key", "ignored but included");
    write(root, "node_modules/x/index.js", "dependency");
    write(root, ".env.local", "local secret");
    fs.rmSync(path.join(root, "removed.txt"));

    const files = await collectFiles(root, ["secret.key"]);
    expect(files.files).toEqual([".env", ".gitignore", "secret.key", "src/index.js", "src/new.js"]);
  });

  it("lists only the project directory of a monorepo, relative to it", async () => {
    const root = repo({ "apps/api/.spawner/spawner.yaml": "x", "apps/api/server.js": "x", "apps/web/index.html": "x" });
    const files = await collectFiles(path.join(root, "apps/api"));
    expect(files.files).toEqual([".spawner/spawner.yaml", "server.js"]);
  });

  it("walks a directory outside git", async () => {
    const root = tempDir();
    write(root, "index.js", "x");
    write(root, "node_modules/x.js", "x");
    write(root, ".env", "x");
    write(root, ".git/config", "x");
    expect((await collectFiles(root)).files).toEqual(["index.js"]);
  });

  it("skips submodules with a reason", async () => {
    const inner = repo({ "lib.js": "x" });
    const root = repo({ "index.js": "x" });
    git(root, "-c", "protocol.file.allow=always", "submodule", "add", "-q", inner, "lib");
    const files = await collectFiles(root);
    expect(files.skipped).toEqual([{ path: "lib", reason: "git submodule (not sent)" }]);
    expect(files.files).not.toContain("lib");
  });

  it("sends a repository cloned inside as its own git sees it, but not a submodule", async () => {
    const root = repo({ ".gitignore": "old/\n", "index.js": "x" });
    git(root, "-c", "protocol.file.allow=always", "submodule", "add", "-q", repo({ "lib.js": "x" }), "lib");
    const admin = repo({ ".gitignore": "dist/\n", "src/main.js": "x" }, path.join(root, "admin"));
    write(admin, "src/new.js", "uncommitted");
    write(admin, "dist/bundle.js", "ignored");
    write(admin, "node_modules/x/index.js", "dependency");
    write(admin, ".env", "local secret");
    repo({ "legacy.js": "x" }, path.join(root, "old"));

    const files = await collectFiles(root);
    expect(files.files).toEqual([".gitignore", ".gitmodules", "admin/.gitignore", "admin/src/main.js", "admin/src/new.js", "index.js"]);
    expect(files.repositories).toEqual(["admin"]);
    expect(files.skipped).toEqual([{ path: "lib", reason: "git submodule (not sent)" }]);
  });

  it("sends a repository committed without .gitmodules, but not its empty directory in a clone", async () => {
    const root = repo({ "index.js": "x" });
    repo({ "lib.js": "x" }, path.join(root, "lib"));
    git(root, "add", "lib");
    git(root, "commit", "-q", "-m", "lib");
    expect((await collectFiles(root)).files).toEqual(["index.js", "lib/lib.js"]);

    const clone = path.join(tempDir(), "clone");
    git(root, "clone", "-q", root, clone);
    const files = await collectFiles(clone);
    expect(files.files).toEqual(["index.js"]);
    expect(files.repositories).toEqual([]);
    expect(files.skipped).toEqual([{ path: "lib", reason: "git submodule (not sent)" }]);
  });

  it("goes down the repositories cloned in cloned repositories, with upload.include", async () => {
    const root = repo({ "index.js": "x" });
    const api = repo({ ".gitignore": ".env.preview\ncerts/\n", "server.js": "x" }, path.join(root, "services/api"));
    write(api, ".env.preview", "included");
    write(api, ".env.local", "local secret");
    write(api, "certs/dev.pem", "included");
    repo({ "plugin.js": "x" }, path.join(api, "plugins/auth"));

    const files = await collectFiles(root, ["services/api/.env.preview", "**/*.pem"]);
    expect(files.files).toEqual([
      "index.js",
      "services/api/.env.preview",
      "services/api/.gitignore",
      "services/api/certs/dev.pem",
      "services/api/plugins/auth/plugin.js",
      "services/api/server.js",
    ]);
    expect(files.repositories).toEqual(["services/api", "services/api/plugins/auth"]);
  });

  it("sends a worktree of another repository, not one of its own", async () => {
    const root = repo({ "index.js": "x" });
    git(root, "worktree", "add", "-q", "-b", "other", "wt");
    git(repo({ "server.js": "x" }), "worktree", "add", "-q", "-b", "feature", path.join(root, "api"));

    const files = await collectFiles(root);
    expect(files.files).toEqual(["api/server.js", "index.js"]);
    expect(files.repositories).toEqual(["api"]);
    expect(files.skipped).toEqual([{ path: "wt", reason: "git worktree (not sent)" }]);
  });

  it("never runs the fsmonitor a repository's config names", async () => {
    const root = repo({ "index.js": "x" });
    const admin = repo({ "main.js": "x" }, path.join(root, "admin"));
    const marker = path.join(tempDir(), "ran");
    for (const dir of [root, admin]) {
      git(dir, "config", "core.fsmonitor", `touch '${marker}' #`);
    }

    expect((await collectFiles(root)).files).toEqual(["admin/main.js", "index.js"]);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("tells submodules from cloned repositories in the directory of a monorepo", async () => {
    const root = repo({ "apps/api/server.js": "x" });
    git(root, "-c", "protocol.file.allow=always", "submodule", "add", "-q", repo({ "lib.js": "x" }), "apps/api/lib");
    repo({ "client.js": "x" }, path.join(root, "apps/api/client"));

    const files = await collectFiles(path.join(root, "apps/api"));
    expect(files.files).toEqual(["client/client.js", "server.js"]);
    expect(files.repositories).toEqual(["client"]);
    expect(files.skipped).toEqual([{ path: "lib", reason: "git submodule (not sent)" }]);
  });
});

describe("globUnder", () => {
  it.each([
    [".env.preview", "", ".env.preview"],
    ["admin/.env.preview", "admin/", ".env.preview"],
    ["./admin/config/", "admin/", "config"],
    ["*/.env.preview", "admin/", ".env.preview"],
    ["api/.env", "admin/", null],
    ["*.pem", "admin/", null],
    ["admin", "admin/", "**"],
    ["services", "services/api/", "**"],
    ["**/*.pem", "admin/", "**"],
  ])("%s under %s: %s", (pattern, prefix, expected) => {
    expect(globUnder(pattern, prefix)).toBe(expected);
  });
});

describe("checkSourceFiles", () => {
  it("refuses symlinks leaving the archive before anything is sent", async () => {
    const root = repo({ "index.js": "x" });
    fs.symlinkSync("../../etc/passwd", path.join(root, "escape"));
    const files = await collectFiles(root);
    expect(() => checkSourceFiles(files, ".", LIMITS, "app")).toThrow(CliError);
  });

  it("accepts a link inside the repository, even outside the project directory", async () => {
    const root = repo({ "packages/shared/index.js": "x", "apps/api/index.js": "x" });
    fs.symlinkSync("../../packages/shared", path.join(root, "apps/api/shared"));
    const files = await collectFiles(path.join(root, "apps/api"));
    expect(() => checkSourceFiles(files, "apps/api", LIMITS, "app")).not.toThrow();
  });

  it("names the largest directories when the source is too large", async () => {
    const root = repo({ "a.txt": "x" });
    write(root, "assets/big.bin", "x".repeat(2000));
    const files = await collectFiles(root);
    let failure: CliError | undefined;
    try {
      checkSourceFiles(files, ".", { maxFiles: 1000, maxExtractedBytes: 1000 }, "app");
    } catch (error) {
      failure = error as CliError;
    }
    expect(failure?.code).toBe("upload_too_large");
    expect(failure?.hint).toContain("assets/ (2.0 KiB)");
  });

  it("counts the repositories cloned inside toward the limits", async () => {
    const root = repo({ "a.txt": "x" });
    repo({ "big.bin": "x".repeat(2000) }, path.join(root, "admin"));
    const files = await collectFiles(root);
    expect(files.bytes).toBe(2001);
    expect(() => checkSourceFiles(files, ".", { maxFiles: 1, maxExtractedBytes: 1024 * 1024 }, "app")).toThrow(/2 files/);
    let failure: CliError | undefined;
    try {
      checkSourceFiles(files, ".", { maxFiles: 1000, maxExtractedBytes: 1000 }, "app");
    } catch (error) {
      failure = error as CliError;
    }
    expect(failure?.code).toBe("upload_too_large");
    expect(failure?.hint).toContain("admin/ (2.0 KiB)");
  });
});

describe("packFiles", () => {
  it("writes the files under the project directory, links as links, hard links whole", async () => {
    const root = repo({ "apps/api/server.js": "x", "apps/api/@scope.txt": "not an archive" });
    fs.symlinkSync("server.js", path.join(root, "apps/api/main.js"));
    write(root, "apps/api/original.txt", "same inode");
    fs.linkSync(path.join(root, "apps/api/original.txt"), path.join(root, "apps/api/hardlink.txt"));
    const files = await collectFiles(path.join(root, "apps/api"));

    const archive = path.join(tempDir(), "app.tar.gz");
    const size = await packFiles(files, "apps/api", archive);
    expect(size).toBeGreaterThan(0);
    expect((await entries(archive)).sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: "apps/api/@scope.txt", type: "File" },
      { path: "apps/api/hardlink.txt", type: "File" },
      { path: "apps/api/main.js", type: "SymbolicLink", linkpath: "server.js" },
      { path: "apps/api/original.txt", type: "File" },
      { path: "apps/api/server.js", type: "File" },
    ]);
  });
});
