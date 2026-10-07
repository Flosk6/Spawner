import { parseDuration } from "@spawner/core";
import type { Capacity, CrashLoop, CreatedShareLink, Environment, EnvironmentEvents, Job, JobAccepted, PreviewToken, ServiceState, ServiceUsage, TimelineEvent } from "@spawner/types";
import { CliError, usageError } from "../errors";
import { Context, findEnvironment, jobLogTail, resolveTarget, waitForJob, type TargetOptions } from "../context";

/** What `spawner status --json` prints. */
export interface StatusResult {
  environment: Environment;
  services: ServiceState[];
  /** The last events of its timeline, newest first: crashes, out-of-memory kills, failed healthchecks, jobs. */
  events: TimelineEvent[];
  /** Services that crashed at least three times in ten minutes, and why. */
  crashLoops: CrashLoop[];
}

const STATUS_EVENTS = 20;

/**
 * An environment, the state of its services (health, restarts, kills for
 * lack of memory) and its last events, so that an agent sees a crashed
 * service and why.
 */
export async function status(ctx: Context, options: TargetOptions): Promise<StatusResult> {
  const environment = await findEnvironment(ctx, await resolveTarget(ctx, options));
  const [services, timeline] = await Promise.all([
    ctx.api().get<ServiceState[]>(`/envs/${environment.id}/services`),
    ctx
      .api()
      .get<EnvironmentEvents>(`/envs/${environment.id}/events`, { limit: STATUS_EVENTS })
      .catch(() => ({ events: [], crashLoops: [] })),
  ]);
  return { environment, services, events: timeline.events, crashLoops: timeline.crashLoops };
}

/**
 * Room for more environments of each project (or of one), from the memory
 * the server can hand out and its free disk.
 */
export async function capacity(ctx: Context, options: { project?: string }): Promise<Capacity> {
  const result = await ctx.api().get<Capacity>("/system/capacity");
  return options.project ? { ...result, projects: result.projects.filter((project) => project.project === options.project) } : result;
}

/**
 * Live environments: of one project, or all, or the caller's own.
 */
export async function list(ctx: Context, options: { project?: string; mine?: boolean }): Promise<{ environments: Environment[] }> {
  const environments = await ctx.api().get<Environment[]>("/envs", { project: options.project, mine: options.mine ? "true" : undefined });
  return { environments };
}

/** What `spawner stats --json` prints. */
export interface StatsResult {
  environment: Environment;
  services: ServiceUsage[];
}

/**
 * CPU, memory and disk of each service right now, with restarts and kills
 * for lack of memory.
 */
export async function stats(ctx: Context, options: TargetOptions): Promise<StatsResult> {
  const environment = await findEnvironment(ctx, await resolveTarget(ctx, options));
  const services = await ctx.api().get<ServiceUsage[]>(`/envs/${environment.id}/services`, { usage: "true" });
  return { environment, services };
}

/** What `spawner url --json` prints. */
export interface UrlResult {
  project: string;
  env: string;
  exposure: string;
  url: string;
  urls: Record<string, string>;
  /** With --with-token: the header that opens the protected URLs for an hour. */
  header?: { name: string; value: string };
  expiresAt?: string;
}

/**
 * The URL of an exposure (the entrypoint by default), and with withToken
 * the header an agent sends to call it.
 */
export async function url(ctx: Context, options: TargetOptions & { exposure?: string; withToken?: boolean }): Promise<UrlResult> {
  const environment = await findEnvironment(ctx, await resolveTarget(ctx, options));
  const exposure = options.exposure
    ? environment.exposures.find((candidate) => candidate.name === options.exposure)
    : (environment.exposures.find((candidate) => candidate.entrypoint) ?? environment.exposures[0]);
  if (!exposure) {
    if (environment.exposures.length === 0) {
      throw new CliError(`${environment.slug} has no URL yet (status: ${environment.status})`, { code: "not_ready", hint: `wait for it: spawner status ${environment.slug}` });
    }
    throw usageError(`${environment.slug} has no exposure "${options.exposure}"`, `its exposures: ${environment.exposures.map((candidate) => candidate.name).join(", ")}`);
  }
  const result: UrlResult = {
    project: environment.project,
    env: environment.slug,
    exposure: exposure.name,
    url: environment.urls[exposure.name],
    urls: environment.urls,
  };
  if (options.withToken) {
    const token = await ctx.api().post<PreviewToken>(`/envs/${environment.id}/preview-token`);
    result.header = { name: token.header, value: token.token };
    result.expiresAt = token.expiresAt;
  }
  return result;
}

/**
 * A link that opens the environment without an account, until it expires.
 *
 * @param ttl - Whole hours, such as "24h" or "3d"
 */
export async function share(ctx: Context, options: TargetOptions & { ttl?: string }): Promise<CreatedShareLink & { env: string }> {
  let ttlHours: number | undefined;
  if (options.ttl !== undefined) {
    const seconds = parseDuration(options.ttl);
    if (seconds === null || seconds < 3600 || seconds % 3600 !== 0) {
      throw usageError(`--ttl ${options.ttl}: give whole hours, such as "24h" or "3d"`);
    }
    ttlHours = seconds / 3600;
  }
  const environment = await findEnvironment(ctx, await resolveTarget(ctx, options));
  const link = await ctx.api().post<CreatedShareLink>(`/envs/${environment.id}/share`, ttlHours === undefined ? {} : { ttlHours });
  return { env: environment.slug, ...link };
}

/** What stop, start and down print. */
export interface LifecycleResult {
  environment: Environment;
  job: Job;
  waited: boolean;
  timedOut: boolean;
  logTail?: string[];
}

const LIFECYCLE_TIMEOUT_SEC = 10 * 60;

/**
 * Stops, starts or deletes an environment, and with wait follows the job to
 * its end.
 */
export async function lifecycle(
  ctx: Context,
  action: "stop" | "start" | "down",
  options: TargetOptions & { wait?: boolean; timeoutSec?: number; onProgress?: (message: string) => void },
): Promise<LifecycleResult> {
  const environment = await findEnvironment(ctx, await resolveTarget(ctx, options));
  const api = ctx.api();
  const accepted =
    action === "down" ? await api.delete<JobAccepted>(`/envs/${environment.id}`) : await api.post<JobAccepted>(`/envs/${environment.id}/${action}`);
  const result: LifecycleResult = { environment: accepted.environment, job: accepted.job, waited: false, timedOut: false };
  if (!options.wait) {
    return result;
  }
  const waited = await waitForJob(ctx, accepted.job, accepted.environment, {
    timeoutMs: (options.timeoutSec ?? LIFECYCLE_TIMEOUT_SEC) * 1000,
    onStatus: (state) => options.onProgress?.(`${state}...`),
  });
  Object.assign(result, { environment: waited.environment, job: waited.job, waited: true, timedOut: waited.timedOut });
  if (waited.job.status === "failed") {
    result.logTail = await jobLogTail(ctx, waited.job.id).catch(() => []);
  }
  return result;
}

/**
 * Postpones the expiry: the environment now expires after ttl.
 */
export async function extend(ctx: Context, options: TargetOptions & { ttl: string }): Promise<{ environment: Environment }> {
  if (parseDuration(options.ttl) === null) {
    throw usageError(`--ttl ${options.ttl} is not a duration`, 'use a duration such as "24h" or "3d"');
  }
  const environment = await findEnvironment(ctx, await resolveTarget(ctx, options));
  return { environment: await ctx.api().post<Environment>(`/envs/${environment.id}/extend`, { ttl: options.ttl }) };
}
