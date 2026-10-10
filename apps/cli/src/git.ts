import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { findProgram } from "./runtime";

let gitPath: string | null | undefined;

/**
 * Runs git with an argument array (never through a shell), without
 * prompts, and returns its standard output. git runs by its absolute path
 * from the PATH, never from the worktree it works in (see findProgram), and
 * with core.fsmonitor off: git runs in the repositories cloned inside a
 * project too, whose config could otherwise name a command to run.
 */
export function git(args: string[], cwd: string): Promise<string> {
  if (gitPath === undefined) {
    gitPath = findProgram("git");
  }
  const program = gitPath;
  return new Promise((resolve, reject) => {
    if (!program) {
      reject(Object.assign(new Error("git is not installed, or not in the PATH"), { code: "ENOENT" }));
      return;
    }
    execFile(
      program,
      ["-c", "core.fsmonitor=false", ...args],
      { cwd, maxBuffer: 512 * 1024 * 1024, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" } },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(new Error(stderr.trim() || error.message), { code: (error as NodeJS.ErrnoException).code }));
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

/**
 * Top directory of the git working tree holding dir.
 *
 * @returns Its real path, or null outside git (or without git installed)
 */
export async function gitTopLevel(dir: string): Promise<string | null> {
  try {
    return (await git(["rev-parse", "--show-toplevel"], dir)).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Where dir sits in its git working tree.
 *
 * @returns The top of the working tree, the path of dir in it ("" at the
 *   top, "apps/api/" below), and the real path of the git directory that
 *   the worktrees of its repository share
 * @throws Outside git
 */
export async function gitLocation(dir: string): Promise<{ top: string; prefix: string; gitDir: string }> {
  const [top, prefix, gitDir] = (await git(["rev-parse", "--show-toplevel", "--show-prefix", "--git-common-dir"], dir)).split("\n");
  return { top, prefix, gitDir: fs.realpathSync.native(path.resolve(dir, gitDir)) };
}

/**
 * Paths of the submodules that the .gitmodules of a working tree declares,
 * relative to its top, checked out or not.
 */
export async function gitSubmodulePaths(top: string): Promise<string[]> {
  try {
    const output = await git(["config", "-z", "--file", path.join(top, ".gitmodules"), "--get-regexp", "^submodule\\..*\\.path$"], top);
    return splitNul(output).map((entry) => entry.slice(entry.indexOf("\n") + 1));
  } catch {
    return [];
  }
}

/**
 * Branch checked out in dir.
 *
 * @returns The short branch name, or null when HEAD is detached or outside git
 */
export async function gitBranch(dir: string): Promise<string | null> {
  try {
    return (await git(["symbolic-ref", "--short", "-q", "HEAD"], dir)).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Splits the NUL-separated output of a -z git command.
 */
export function splitNul(output: string): string[] {
  return output.split("\0").filter((entry) => entry.length > 0);
}
