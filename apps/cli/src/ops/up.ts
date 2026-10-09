import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { formatIssue, parseDuration, parseManifest, type Issue } from "@spawner/core";
import type { Environment, Job, JobAccepted, ProjectDetail } from "@spawner/types";
import { sanitizeGitBranch } from "@spawner/utils";
import { checkSourceFiles, collectFiles, packFiles } from "../archive";
import { checkProject } from "../check";
import { CliError, EXIT, usageError, type ExitCode } from "../errors";
import { formatBytes, formatDuration } from "../format";
import { gitTopLevel } from "../git";
import { Context, findEnvironmentOrNull, jobLogTail, waitForJob } from "../context";
import { checkEnvName, envNameFromBranch, requireWorkspace } from "../workspace";

export interface UpOptions {
  /** Directory of the worktree (default: the current directory). */
  path?: string;
  /** Environment name (default: from the branch). */
  env?: string;
  /** Sources sent from local directories: { front: "../front" }. */
  sources?: Record<string, string>;
  /** Sources taken from git at a ref: { front: "develop" }; the project's own name deploys it from git too. */
  refs?: Record<string, string>;
  fresh?: boolean;
  reseed?: boolean;
  /** Lifetime, such as "24h". */
  ttl?: string;
  wait?: boolean;
  timeoutSec?: number;
  /** Progress, for humans and MCP clients. */
  onProgress?: (message: string) => void;
  /** Called once the server accepted the job, before waiting for it. */
  onJob?: (job: Job, environment: Environment) => void;
  signal?: AbortSignal;
}

export interface UploadSummary {
  source: string;
  files: number;
  bytes: number;
  archiveBytes: number;
}

/** What `spawner up --json` prints. */
export interface UpResult {
  action: "created" | "updated";
  environment: Environment;
  job: Job;
  uploads: UploadSummary[];
  warnings: string[];
  waited: boolean;
  timedOut: boolean;
  /** End of the job log, when the job failed. */
  logTail?: string[];
}

const DEFAULT_TIMEOUT_SEC = 30 * 60;
const LOG_TAIL_LINES = 40;

/**
 * Creates or updates the environment of a worktree: checks spawner.yaml and
 * the compose file locally, packs the worktree (and the --source
 * directories), sends them, and with wait follows the job to its end.
 */
export async function up(ctx: Context, options: UpOptions): Promise<UpResult> {
  const progress = options.onProgress ?? (() => undefined);
  const workspace = await requireWorkspace(options.path ? path.resolve(ctx.cwd, options.path) : ctx.cwd);
  const env = options.env ? checkEnvName(options.env) : envNameFromBranch(workspace.branch);
  const refs = options.refs ?? {};
  const sourceDirs = await resolveSourceDirs(ctx, options.sources ?? {});
  for (const [name, ref] of Object.entries(refs)) {
    try {
      sanitizeGitBranch(ref);
    } catch (error) {
      throw usageError(`--ref ${name}=${ref}: ${(error as Error).message}`);
    }
  }
  const ttlSeconds = options.ttl === undefined ? undefined : parseDuration(options.ttl);
  if (ttlSeconds === null) {
    throw usageError(`--ttl ${options.ttl} is not a duration`, 'use a duration such as "24h" or "3d"');
  }

  const info = await ctx.info();
  const parsed = parseManifest(workspace.manifestText);
  if (!parsed.manifest) {
    throw refused(checkProject(workspace, env, info, sourceDirs).issues);
  }
  const project = await projectOf(ctx, parsed.manifest.project);
  const check = checkProject(workspace, env, info, sourceDirs, {
    allowPublic: project.allowPublic ?? true,
    allowAlwaysOn: project.allowAlwaysOn ?? true,
    variables: (project.variables ?? []).map((variable) => variable.name),
    sourceRepos: project.sourceRepos ? [project.repoUrl, ...project.sourceRepos] : null,
  });
  if (check.issues.length > 0) {
    throw refused(check.issues);
  }
  check.warnings?.forEach((warning) => options.onProgress?.(`Warning: ${warning}`));
  const manifest = check.manifest!;
  const primaryFromGit = manifest.name in refs;
  const declared = new Set([manifest.name, ...Object.keys(manifest.sources)]);
  const unknown = [...Object.keys(sourceDirs), ...Object.keys(refs)].filter((name) => !declared.has(name));
  if (unknown.length > 0) {
    throw usageError(`spawner.yaml declares no source ${unknown.join(", ")}`, `its sources: ${[...declared].join(", ")}`);
  }
  if (manifest.name in sourceDirs) {
    throw usageError(`"${manifest.name}" is this worktree: it is always sent, or taken from git with --ref ${manifest.name}=<branch>`);
  }

  const expectedRoot = normalizeRootDir(project.rootDir);
  if (expectedRoot !== workspace.rootDir) {
    throw usageError(
      `spawner.yaml is in ${workspace.rootDir === "." ? "the root of the repository" : workspace.rootDir}, but project ${project.slug} expects it in ${expectedRoot === "." ? "the root" : expectedRoot}`,
      "an admin sets the project's root directory in the dashboard (Projects)",
    );
  }

  const warnings: string[] = [];
  const uploads: UploadSummary[] = [];
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "spawner-up-"));
  try {
    const form = new FormData();
    const archive = async (name: string, root: string, prefix: string, include: string[], field: string) => {
      const files = await collectFiles(root, include);
      files.skipped.forEach((skip) => warnings.push(`${name}: ${skip.path} skipped (${skip.reason})`));
      checkSourceFiles(files, prefix, info.limits.upload, name);
      progress(`Packing ${name}: ${files.files.length} files, ${formatBytes(files.bytes)}`);
      const target = path.join(temporary, `${field.replace(":", "-")}.tar.gz`);
      const archiveBytes = await packFiles(files, prefix, target);
      if (archiveBytes > info.limits.upload.maxBytes) {
        throw new CliError(`${name}: the archive is ${formatBytes(archiveBytes)}, the server accepts ${formatBytes(info.limits.upload.maxBytes)}`, {
          code: "upload_too_large",
          hint: "add generated files to .gitignore",
        });
      }
      form.append(field, await fileBlob(target), `${field.replace(":", "-")}.tar.gz`);
      uploads.push({ source: name, files: files.files.length, bytes: files.bytes, archiveBytes });
    };

    if (primaryFromGit) {
      form.append("primary", JSON.stringify({ ref: refs[manifest.name] }));
    } else {
      await archive(manifest.name, workspace.projectRoot, workspace.rootDir, manifest.upload.include, "primary");
    }
    for (const [name, dir] of Object.entries(sourceDirs)) {
      await archive(name, dir, ".", [], `source:${name}`);
    }
    const gitSources = Object.fromEntries(Object.entries(refs).filter(([name]) => name !== manifest.name).map(([name, ref]) => [name, { ref }]));
    if (Object.keys(gitSources).length > 0) {
      form.append("sources", JSON.stringify(gitSources));
    }
    if (ttlSeconds !== undefined) {
      form.append("ttl", `${Math.round(ttlSeconds)}s`);
    }

    const existing = await findEnvironmentOrNull(ctx, { project: manifest.project, env });
    const send = (target: Environment | null) => {
      const body = new FormData();
      for (const [key, value] of form.entries()) {
        body.append(key, value);
      }
      if (target) {
        if (options.fresh) {
          body.append("fresh", "true");
        }
        if (options.reseed) {
          body.append("reseed", "true");
        }
        return ctx.api().request<JobAccepted>("POST", `/envs/${target.id}/update`, { form: body, timeoutMs: 10 * 60_000 });
      }
      body.append("project", manifest.project);
      body.append("env", env);
      body.append("createdVia", ctx.via);
      return ctx.api().request<JobAccepted>("POST", "/envs", { form: body, timeoutMs: 10 * 60_000 });
    };

    progress(`${existing ? "Updating" : "Creating"} ${env} in ${manifest.project}`);
    let action: UpResult["action"] = existing ? "updated" : "created";
    let accepted: JobAccepted;
    try {
      accepted = await send(existing);
    } catch (error) {
      if (existing || !(error instanceof CliError) || error.status !== 409) {
        throw error;
      }
      const raced = await findEnvironmentOrNull(ctx, { project: manifest.project, env });
      if (!raced) {
        throw error;
      }
      action = "updated";
      accepted = await send(raced);
    }

    const result: UpResult = { action, environment: accepted.environment, job: accepted.job, uploads, warnings, waited: false, timedOut: false };
    options.onJob?.(accepted.job, accepted.environment);
    if (!options.wait) {
      return result;
    }
    const started = Date.now();
    progress(`Job ${accepted.job.id} queued`);
    const waited = await waitForJob(ctx, accepted.job, accepted.environment, {
      timeoutMs: (options.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000,
      onStatus: (status) => status !== "ready" && progress(`${status}...`),
      signal: options.signal,
    });
    Object.assign(result, { environment: waited.environment, job: waited.job, waited: true, timedOut: waited.timedOut });
    if (waited.job.status === "succeeded") {
      progress(`Ready in ${formatDuration((Date.now() - started) / 1000)}`);
    } else if (waited.job.status === "failed") {
      result.logTail = await jobLogTail(ctx, waited.job.id, LOG_TAIL_LINES).catch(() => []);
    }
    return result;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

/**
 * Exit code of `up` and of the other commands that wait for a job: 4 when
 * the job failed, 6 for lack of capacity, 7 when the files were refused, 5
 * when the wait timed out.
 */
export function jobExitCode(result: { waited: boolean; timedOut: boolean; job: Job | null }): ExitCode {
  if (!result.waited || !result.job) {
    return EXIT.ok;
  }
  if (result.timedOut) {
    return EXIT.timeout;
  }
  if (result.job.status !== "failed") {
    return EXIT.ok;
  }
  return result.job.errorCode === "capacity" ? EXIT.capacity : result.job.errorCode === "invalid" ? EXIT.refused : EXIT.failed;
}

/**
 * Local directories of the --source options, each at the top of its git
 * worktree: a source is a whole repository.
 */
async function resolveSourceDirs(ctx: Context, sources: Record<string, string>): Promise<Record<string, string>> {
  const dirs: Record<string, string> = {};
  for (const [name, dir] of Object.entries(sources)) {
    const absolute = path.resolve(ctx.cwd, dir);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
      throw usageError(`--source ${name}=${dir}: no such directory`);
    }
    dirs[name] = fs.realpathSync.native((await gitTopLevel(absolute)) ?? absolute);
  }
  return dirs;
}

async function projectOf(ctx: Context, slug: string): Promise<ProjectDetail> {
  try {
    return await ctx.api().get<ProjectDetail>(`/projects/${slug}`);
  } catch (error) {
    if (error instanceof CliError && error.status === 404) {
      throw new CliError(`project "${slug}" is not registered on ${ctx.server}`, {
        code: "not_found",
        hint: "an admin creates it in the dashboard (Projects), with the repository and the directory of .spawner/",
      });
    }
    throw error;
  }
}

/**
 * A file as a Blob read from disk when it is sent (fs.openAsBlob), not
 * loaded in memory first.
 */
async function fileBlob(file: string): Promise<Blob> {
  const open = (fs as { openAsBlob?: (path: string, options?: { type?: string }) => Promise<Blob> }).openAsBlob;
  return open ? open(file, { type: "application/gzip" }) : new Blob([fs.readFileSync(file)], { type: "application/gzip" });
}

function normalizeRootDir(rootDir: string | null | undefined): string {
  const clean = (rootDir ?? ".").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  return clean === "" ? "." : clean;
}

/**
 * The error of a refused spawner.yaml or compose file (exit code 7), with
 * every issue.
 */
export function refused(issues: Issue[]): CliError {
  return new CliError(`refused before upload:\n${issues.map((issue) => `  ${formatIssue(issue)}`).join("\n")}`, {
    exit: EXIT.refused,
    code: "refused",
    hint: "fix these in .spawner/, then run spawner up again",
    details: { issues },
  });
}
