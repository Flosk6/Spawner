import type { Environment, Job, ServerInfo } from "@spawner/types";
import { ApiClient } from "./api";
import { credentialsPath, notLoggedIn, readCredentials, resolveConnection, type Connection } from "./config";
import { CliError, usageError } from "./errors";
import { checkEnvName, envNameFromBranch, loadWorkspace, manifestProject, type Workspace } from "./workspace";

/**
 * What every operation runs with: where it runs, which server it talks to,
 * and for whom (the CLI or the MCP server, recorded on environments).
 */
export class Context {
  private client?: ApiClient;
  private serverInfo?: Promise<ServerInfo>;

  constructor(
    readonly cwd: string,
    readonly env: NodeJS.ProcessEnv,
    readonly via: "cli" | "mcp",
    private readonly connection: Connection = resolveConnection(env, readCredentials(credentialsPath(env))),
    private readonly fetchImpl?: typeof fetch,
  ) {}

  get server(): string | null {
    return this.connection.server;
  }

  get source(): Connection["source"] {
    return this.connection.source;
  }

  /**
   * The API of the server logged in to.
   *
   * @throws CliError (exit 3) when not logged in
   */
  api(): ApiClient {
    if (!this.connection.server || !this.connection.token) {
      throw notLoggedIn(this.connection.server);
    }
    this.client ??= new ApiClient(this.connection.server, this.connection.token, this.via, this.fetchImpl);
    return this.client;
  }

  /** Version, domain and limits of the server, fetched once. */
  info(): Promise<ServerInfo> {
    this.serverInfo ??= this.api().get<ServerInfo>("/info");
    return this.serverInfo;
  }
}

/** How a command names an environment. */
export interface TargetOptions {
  /** Environment name; by default, the branch of the worktree. */
  env?: string;
  /** Project slug; by default, the project of spawner.yaml. */
  project?: string;
  /** Directory to start from, instead of the current one. */
  path?: string;
}

export interface Target {
  project: string;
  env: string;
  workspace: Workspace | null;
}

/**
 * Finds the project and the environment a command is about: the options
 * first, then SPAWNER_PROJECT, then spawner.yaml and the branch of the
 * directory.
 */
export async function resolveTarget(ctx: Context, options: TargetOptions): Promise<Target> {
  const needsWorkspace = Boolean(options.path) || !options.env || (!options.project && !ctx.env.SPAWNER_PROJECT);
  const workspace = needsWorkspace ? await loadWorkspace(options.path ?? ctx.cwd) : null;
  const project = options.project ?? ctx.env.SPAWNER_PROJECT ?? (workspace ? manifestProject(workspace) : null);
  if (!project) {
    throw usageError(
      workspace ? "spawner.yaml does not name its project" : "no project here",
      "run this in a directory with .spawner/spawner.yaml, or pass --project <slug>",
    );
  }
  const env = options.env ? checkEnvName(options.env) : envNameFromBranch(workspace?.branch ?? null);
  return { project, env, workspace };
}

/**
 * The live environment a target names.
 *
 * @throws CliError not_found, with a hint to list or create environments
 */
export async function findEnvironment(ctx: Context, target: Pick<Target, "project" | "env">): Promise<Environment> {
  try {
    const [environment] = await ctx.api().get<Environment[]>("/envs", { project: target.project, slug: target.env });
    if (environment) {
      return environment;
    }
  } catch (error) {
    if (!(error instanceof CliError) || error.status !== 404) {
      throw error;
    }
  }
  throw new CliError(`no environment "${target.env}" in project "${target.project}"`, {
    code: "not_found",
    hint: `list them with: spawner ls --project ${target.project}; create it with: spawner up ${target.env}`,
  });
}

/**
 * The environment, or null when it does not exist.
 */
export async function findEnvironmentOrNull(ctx: Context, target: Pick<Target, "project" | "env">): Promise<Environment | null> {
  try {
    return await findEnvironment(ctx, target);
  } catch (error) {
    if (error instanceof CliError && error.code === "not_found") {
      return null;
    }
    throw error;
  }
}

const FINISHED = new Set(["succeeded", "failed", "cancelled"]);

export interface WaitResult {
  job: Job;
  environment: Environment;
  timedOut: boolean;
}

/**
 * Waits for a job to end, reporting each status the environment goes
 * through (preparing, building, seeding...). The status it had when the job
 * was queued is not reported: an environment being updated is still ready.
 *
 * @param timeoutMs - Gives up after this long; the job goes on on the server
 */
export async function waitForJob(
  ctx: Context,
  job: Job,
  initial: Environment,
  options: { timeoutMs: number; onStatus?: (status: string) => void; signal?: AbortSignal },
): Promise<WaitResult> {
  const api = ctx.api();
  const deadline = Date.now() + options.timeoutMs;
  let current = job;
  let environment: Environment = initial;
  for (let attempt = 0; ; attempt++) {
    current = await api.get<Job>(`/jobs/${job.id}`);
    const latest = await environmentOrGone(ctx, job.environmentId);
    if (latest && latest.status !== environment.status) {
      options.onStatus?.(latest.status);
    }
    environment = latest ?? { ...environment, status: "deleted" };
    if (FINISHED.has(current.status)) {
      return { job: current, environment, timedOut: false };
    }
    if (Date.now() >= deadline) {
      return { job: current, environment, timedOut: true };
    }
    await sleep(attempt < 40 ? 1500 : 3000, options.signal);
  }
}

/**
 * An environment by id, or null once it is deleted.
 */
async function environmentOrGone(ctx: Context, id: string): Promise<Environment | null> {
  try {
    return await ctx.api().get<Environment>(`/envs/${id}`);
  } catch (error) {
    if (error instanceof CliError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new CliError("interrupted", { code: "interrupted" }));
      },
      { once: true },
    );
  });
}

/**
 * The last lines of a job's log, to show why it failed.
 */
export async function jobLogTail(ctx: Context, jobId: string, lines = 40): Promise<string[]> {
  const text = await ctx.api().text(`/jobs/${jobId}/logs`);
  return text.split("\n").filter((line) => line.length > 0).slice(-lines);
}
