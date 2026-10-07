import { spawn } from "child_process";

export interface RunOptions {
  cwd?: string;
  env: Record<string, string>;
  timeoutMs?: number;
  onLine?: (line: string) => void;
  maxOutputBytes?: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

/**
 * Error of a command that failed, timed out or could not start. The message
 * ends with the last lines of stderr, which is where tools explain failures.
 */
export class CommandError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly stderr: string,
    reason: string,
  ) {
    const tail = stderr.trim().split("\n").slice(-15).join("\n");
    super(tail ? `${reason}\n${tail}` : reason);
    this.name = "CommandError";
  }
}

/**
 * Runs a program with an argument array. There is never a shell, so no
 * argument is ever interpreted. The child only gets the environment given
 * here, not Spawner's own (which holds its secrets). Output lines can be
 * streamed while the program runs.
 *
 * @param file - Program to run, found through env.PATH
 * @param args - Arguments, passed as they are
 * @param options - Working directory, environment, timeout, line callback
 * @returns The collected stdout and stderr (each capped)
 */
export function run(file: string, args: string[], options: RunOptions): Promise<RunResult> {
  const max = options.maxOutputBytes ?? 4 * 1024 * 1024;
  const command = [file, ...args].join(" ");

  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let pending = "";
    let timedOut = false;

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 5000).unref();
        }, options.timeoutMs)
      : null;

    const collect = (chunk: Buffer, target: "stdout" | "stderr") => {
      const text = chunk.toString("utf8");
      if (target === "stdout" && stdout.length < max) {
        stdout += text;
      }
      if (target === "stderr" && stderr.length < max) {
        stderr += text;
      }
      if (options.onLine) {
        pending += text;
        const lines = pending.split(/\r?\n|\r/);
        pending = lines.pop() ?? "";
        lines.filter((line) => line.length > 0).forEach(options.onLine);
      }
    };

    child.stdout.on("data", (chunk: Buffer) => collect(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, "stderr"));

    child.on("error", (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      reject(new CommandError(command, null, stderr, `${file} could not start: ${error.message}`));
    });

    child.on("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (options.onLine && pending) {
        options.onLine(pending);
      }
      if (timedOut) {
        reject(new CommandError(command, code, stderr, `${file} timed out after ${Math.round((options.timeoutMs ?? 0) / 1000)}s`));
      } else if (code !== 0) {
        reject(new CommandError(command, code, stderr, `${file} exited with code ${code}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * The minimal environment given to child programs: a PATH and a HOME, never
 * the variables of the Spawner process.
 */
export function baseEnv(home: string): Record<string, string> {
  return {
    PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: home,
    LANG: "C.UTF-8",
  };
}
