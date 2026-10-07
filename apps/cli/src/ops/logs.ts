import { parseDuration } from "@spawner/core";
import type { Environment, Job, LogLine } from "@spawner/types";
import { CliError, usageError } from "../errors";
import { Context, findEnvironment, resolveTarget, type TargetOptions } from "../context";

export interface LogsOptions extends TargetOptions {
  /** Services to read; all of them by default. */
  services?: string[];
  /** Lines to return (200 by default, 5000 at most). */
  tail?: number;
  /** A duration back from now ("10m") or a date. */
  since?: string;
  /** Only the lines containing this text, ignoring case. */
  grep?: string;
  /** Only the lines reporting errors, with their stack traces. */
  errors?: boolean;
}

/**
 * Turns --since into a date the API reads: "10m" means ten minutes ago.
 */
export function sinceDate(since: string | undefined, now = Date.now()): string | undefined {
  if (since === undefined) {
    return undefined;
  }
  const seconds = parseDuration(since);
  if (seconds !== null) {
    return new Date(now - seconds * 1000).toISOString();
  }
  const date = new Date(since);
  if (Number.isNaN(date.getTime())) {
    throw usageError(`--since ${since}: give a duration ("10m", "2h") or a date ("2026-10-07T10:00:00Z")`);
  }
  return date.toISOString();
}

function query(options: LogsOptions) {
  return {
    service: options.services?.length ? options.services.join(",") : undefined,
    tail: options.tail,
    since: sinceDate(options.since),
    grep: options.grep,
    errors: options.errors ? "true" : undefined,
  };
}

/**
 * The last lines of the services' output, merged in time order.
 */
export async function readLogs(ctx: Context, options: LogsOptions): Promise<{ environment: Environment; lines: LogLine[] }> {
  const environment = await findEnvironment(ctx, await resolveTarget(ctx, options));
  const { lines } = await ctx.api().get<{ lines: LogLine[] }>(`/envs/${environment.id}/logs`, query(options));
  return { environment, lines };
}

/**
 * The last lines, then each new line, until the services stop or the
 * signal aborts.
 */
export async function* followLogs(ctx: Context, environment: Environment, options: LogsOptions, signal?: AbortSignal): AsyncGenerator<LogLine> {
  for await (const event of ctx.api().events(`/envs/${environment.id}/logs`, { ...query(options), follow: "true" }, signal)) {
    if (event.event === "end") {
      return;
    }
    if (event.event === "message") {
      yield JSON.parse(event.data) as LogLine;
    }
  }
}

/**
 * The log of a job: the environment's last job by default.
 */
export async function readJobLog(ctx: Context, options: TargetOptions & { job?: string }): Promise<{ environment: Environment; job: Job; lines: string[] }> {
  const environment = await findEnvironment(ctx, await resolveTarget(ctx, options));
  const jobId = options.job ?? environment.lastJob?.id;
  if (!jobId) {
    throw new CliError(`${environment.slug} has no job`, { code: "not_found" });
  }
  const job = await ctx.api().get<Job>(`/jobs/${jobId}`);
  if (job.environmentId !== environment.id) {
    throw usageError(`job ${jobId} belongs to another environment`);
  }
  const text = await ctx.api().text(`/jobs/${jobId}/logs`);
  return { environment, job, lines: text.split("\n").filter((line) => line.length > 0) };
}

/**
 * Follows a job's log until the job ends.
 */
export async function* followJobLog(ctx: Context, jobId: string, signal?: AbortSignal): AsyncGenerator<string> {
  for await (const event of ctx.api().events(`/jobs/${jobId}/logs/stream`, undefined, signal)) {
    if (event.event === "message") {
      yield event.data;
    }
  }
}
