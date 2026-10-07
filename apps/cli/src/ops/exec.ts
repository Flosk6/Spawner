import type { ExecResult } from "@spawner/types";
import { CliError, usageError } from "../errors";
import { Context, findEnvironment, resolveTarget, type TargetOptions } from "../context";

export interface ExecOptions extends TargetOptions {
  service: string;
  argv: string[];
  timeoutSec?: number;
  /** Sent to the command's standard input, then closed. */
  stdin?: Buffer;
}

/**
 * Runs a command in a service (an argument array, no shell on the server)
 * and returns its exit code and outputs.
 */
export async function exec(ctx: Context, options: ExecOptions): Promise<ExecResult & { env: string; service: string }> {
  if (options.argv.length === 0) {
    throw usageError("no command to run", "put it after --: spawner exec <env> <service> -- <command> [args...]");
  }
  const environment = await findEnvironment(ctx, await resolveTarget(ctx, options));
  const info = await ctx.info();
  if (options.stdin && options.stdin.length > info.limits.exec.maxStdinBytes) {
    throw usageError(`the standard input is larger than ${info.limits.exec.maxStdinBytes / 1024 / 1024} MiB`);
  }
  try {
    const result = await ctx.api().request<ExecResult>("POST", `/envs/${environment.id}/exec`, {
      json: {
        service: options.service,
        argv: options.argv,
        timeoutSec: options.timeoutSec,
        ...(options.stdin ? { stdin: options.stdin.toString("base64") } : {}),
      },
      timeoutMs: ((options.timeoutSec ?? 120) + 30) * 1000,
    });
    return { env: environment.slug, service: options.service, ...result };
  } catch (error) {
    if (error instanceof CliError && error.status === 409) {
      throw new CliError(error.message, { code: "not_running", status: 409, hint: `spawner status ${environment.slug} shows the services and their state` });
    }
    throw error;
  }
}
