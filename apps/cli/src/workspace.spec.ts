import * as path from "path";
import { describe, expect, it } from "vitest";
import { CliError, EXIT } from "./errors";
import { git, repo, tempDir, write } from "./testing/repo";
import { checkEnvName, envNameFromBranch, findProjectRoot, loadWorkspace, manifestProject } from "./workspace";

describe("workspaces", () => {
  it("finds spawner.yaml from a subdirectory and the branch of the worktree", async () => {
    const root = repo({ ".spawner/spawner.yaml": "project: blog\n", "src/app.js": "x" });
    git(root, "checkout", "-q", "-b", "feat/Login_page");
    const workspace = await loadWorkspace(path.join(root, "src"));
    expect(workspace).toMatchObject({ projectRoot: root, repoRoot: root, rootDir: ".", git: true, branch: "feat/Login_page" });
    expect(manifestProject(workspace!)).toBe("blog");
    expect(envNameFromBranch(workspace!.branch)).toBe("feat-login-page");
  });

  it("knows where the project sits in a monorepo", async () => {
    const root = repo({ "apps/api/.spawner/spawner.yaml": "project: api\n" });
    expect(await loadWorkspace(path.join(root, "apps/api"))).toMatchObject({ projectRoot: path.join(root, "apps/api"), rootDir: "apps/api" });
  });

  it("works in a git worktree", async () => {
    const root = repo({ ".spawner/spawner.yaml": "project: blog\n" });
    const worktree = path.join(tempDir(), "feat");
    git(root, "worktree", "add", "-q", "-b", "feat/agent", worktree);
    expect(await loadWorkspace(worktree)).toMatchObject({ repoRoot: worktree, rootDir: ".", branch: "feat/agent" });
  });

  it("works outside git, without a branch", async () => {
    const root = tempDir();
    write(root, ".spawner/spawner.yaml", "project: blog\n");
    expect(findProjectRoot(path.join(root, "deep"))).toBe(root);
    expect(await loadWorkspace(root)).toMatchObject({ git: false, branch: null, rootDir: "." });
    expect(() => envNameFromBranch(null)).toThrow(CliError);
  });

  it("refuses a detached HEAD and invalid names with a usage error", async () => {
    const root = repo({ ".spawner/spawner.yaml": "project: blog\n" });
    git(root, "checkout", "-q", "--detach");
    const workspace = await loadWorkspace(root);
    expect(workspace?.branch).toBeNull();
    try {
      checkEnvName("Feat/Login");
      expect.unreachable();
    } catch (error) {
      expect((error as CliError).exit).toBe(EXIT.usage);
    }
  });
});
