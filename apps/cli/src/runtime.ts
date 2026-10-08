import * as fs from "fs";
import * as path from "path";

/**
 * Keeps Windows from running a program of the working directory when the
 * CLI, or a program it starts, runs one by bare name: libuv and cmd.exe
 * look there before the PATH, and for git it is the user's worktree, where
 * a branch could commit a git.exe. Windows reads the variable from the
 * environment of the process that spawns, hence the CLI's own (libuv honours
 * it from 1.48, Node.js 22; findProgram covers older ones).
 */
export function skipWorkingDirectoryLookup(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): void {
  if (platform === "win32") {
    env.NoDefaultCurrentDirectoryInExePath = "1";
  }
}

/**
 * Why the CLI cannot run on this Node.js.
 *
 * @returns The message to print, or null when the runtime is fine
 */
export function unsupportedRuntime(versions: Pick<NodeJS.ProcessVersions, "node">): string | null {
  const nodeMajor = Number.parseInt(versions.node, 10);
  return nodeMajor < 20 ? `spawner needs Node.js 20 or later (this is v${versions.node})` : null;
}

export interface ProgramLookup {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Whether a candidate path is a program that can run (the file system by default). */
  isProgram?: (candidate: string) => boolean;
}

/**
 * Finds a program in the absolute directories of the PATH, the way libuv
 * does (on Windows, name.com then name.exe), so that the CLI runs it by its
 * absolute path. A bare name would depend on the working directory, which
 * for git is the user's worktree: Windows looks there first, and every
 * platform resolves relative PATH entries (".", "node_modules/.bin")
 * against it.
 *
 * @returns The absolute path, or null when no absolute PATH entry holds it
 */
export function findProgram(name: string, { env = process.env, platform = process.platform, isProgram = runnable }: ProgramLookup = {}): string | null {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const key = platform === "win32" ? Object.keys(env).find((variable) => variable.toUpperCase() === "PATH") : "PATH";
  const directories = ((key && env[key]) || "").split(paths.delimiter).filter((directory) => directory && paths.isAbsolute(directory));
  const names = platform === "win32" && !paths.extname(name) ? [`${name}.com`, `${name}.exe`] : [name];
  for (const directory of directories) {
    for (const candidate of names) {
      const file = paths.join(directory, candidate);
      if (isProgram(file)) {
        return file;
      }
    }
  }
  return null;
}

function runnable(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}
