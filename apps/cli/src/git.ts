import { execFile } from "child_process";
import { findProgram } from "./runtime";

let gitPath: string | null | undefined;

/**
 * Runs git with an argument array (never through a shell), without
 * prompts, and returns its standard output. git runs by its absolute path
 * from the PATH, never from the worktree it works in (see findProgram).
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
      args,
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
