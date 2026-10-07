import * as fs from "fs";
import * as path from "path";
import { envSlugFromBranch, MANIFEST_PATH, slugIssue } from "@spawner/core";
import { parse } from "yaml";
import { usageError } from "./errors";
import { gitBranch, gitTopLevel } from "./git";

/**
 * A directory holding a Spawner project: .spawner/spawner.yaml, in a git
 * worktree or not.
 */
export interface Workspace {
  /** Directory holding .spawner/. */
  projectRoot: string;
  manifestPath: string;
  manifestText: string;
  /** Top of the git working tree, or projectRoot outside git. */
  repoRoot: string;
  /** projectRoot relative to repoRoot, with slashes: "." or "apps/api". */
  rootDir: string;
  git: boolean;
  /** Branch checked out, null outside git or when HEAD is detached. */
  branch: string | null;
}

/**
 * Looks for .spawner/spawner.yaml in start, then in each parent directory.
 *
 * @returns The directory holding .spawner/, or null
 */
export function findProjectRoot(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, MANIFEST_PATH))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Reads the project around start.
 *
 * @returns The workspace, or null when no spawner.yaml is found
 */
export async function loadWorkspace(start: string): Promise<Workspace | null> {
  const found = findProjectRoot(start);
  if (!found) {
    return null;
  }
  const projectRoot = fs.realpathSync.native(found);
  const manifestPath = path.join(projectRoot, MANIFEST_PATH);
  const top = await gitTopLevel(projectRoot);
  const repoRoot = top ? fs.realpathSync.native(top) : projectRoot;
  const rootDir = path.relative(repoRoot, projectRoot).split(path.sep).join("/") || ".";
  return {
    projectRoot,
    manifestPath,
    manifestText: fs.readFileSync(manifestPath, "utf8"),
    repoRoot,
    rootDir,
    git: top !== null,
    branch: top ? await gitBranch(projectRoot) : null,
  };
}

/**
 * Loads the workspace a command needs.
 *
 * @throws A usage error naming the directory when there is none
 */
export async function requireWorkspace(start: string): Promise<Workspace> {
  const workspace = await loadWorkspace(start);
  if (!workspace) {
    throw usageError(`no ${MANIFEST_PATH} in ${path.resolve(start)} or its parents`, "run this in a project directory, or create one with: spawner init");
  }
  return workspace;
}

/**
 * The project slug a manifest declares, read leniently so that commands
 * other than `up` work while spawner.yaml has an error.
 */
export function manifestProject(workspace: Workspace): string | null {
  try {
    const project = (parse(workspace.manifestText) as { project?: unknown } | null)?.project;
    return typeof project === "string" ? project : null;
  } catch {
    return null;
  }
}

/**
 * The environment of a branch: "feat/login" gives "feat-login".
 *
 * @throws A usage error when there is no branch to name it after
 */
export function envNameFromBranch(branch: string | null): string {
  const name = branch ? envSlugFromBranch(branch) : null;
  if (!name) {
    throw usageError(
      branch ? `cannot name an environment after the branch "${branch}"` : "no branch checked out to name the environment after",
      "name it: spawner up <env> (lowercase letters, digits and dashes)",
    );
  }
  return name;
}

/**
 * Checks an environment name given on the command line.
 */
export function checkEnvName(name: string): string {
  const issue = slugIssue("env", name, "env");
  if (issue) {
    throw usageError(issue.message, issue.hint ? `${issue.hint}, at most 29 characters` : undefined);
  }
  return name;
}
