import { Injectable } from "@nestjs/common";
import type { Job, Prisma } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import {
  alwaysOnIssues,
  buildVariables,
  composeProjectName,
  dockerfileLayerWarnings,
  formatIssue,
  MANIFEST_PATH,
  parseManifest,
  prepareCompose,
  publicExposureIssues,
  type Issue,
  type Manifest,
} from "@spawner/core";
import { directorySize } from "../../common/directory-size";
import { DockerService } from "../../common/docker.service";
import { PrismaService } from "../../common/prisma.service";
import { SecretsService } from "../../common/secrets.service";
import { SystemStatsService } from "../system/system-stats.service";
import { ComposeRunner } from "./compose-runner.service";
import { GitMirrorService } from "./git-mirror.service";
import { JobLogsService } from "./job-logs.service";
import { LogArchiveService } from "./log-archive.service";
import { AuditService } from "../audit/audit.service";
import { RouterService } from "./router.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { StorageService } from "./storage.service";
import { UploadRejectedError, UploadService } from "./upload.service";

/**
 * Directory of the project repository inside an environment. Source names
 * are slugs and never contain "_", so it cannot clash with another source.
 */
export const PRIMARY_DIR = "_primary";

export interface SourceRequest {
  origin: "git" | "upload";
  ref?: string;
  archive?: string;
}

/**
 * What a create or update job was asked to do: where each source comes from,
 * and whether to start from scratch or replay the seed.
 */
export interface DeployPayload {
  primary: SourceRequest;
  sources: Record<string, SourceRequest>;
  fresh?: boolean;
  reseed?: boolean;
  /** Lifetime asked for with the deploy, instead of the manifest's ttl. */
  ttlSeconds?: number;
}

/**
 * The uploaded archives a deploy waits for, on disk until its job runs.
 */
export function payloadArchives(payload: Partial<DeployPayload> | null): string[] {
  return [payload?.primary, ...Object.values(payload?.sources ?? {})].flatMap((request) => (request?.archive ? [request.archive] : []));
}

export type JobPhase = "preparing" | "validating" | "building" | "seeding" | "routing" | "deleting" | "stopping" | "starting" | "sleeping" | "waking";

/**
 * Why a job failed, for machines (the CLI turns it into an exit code):
 * invalid (spawner.yaml, the compose file or its variables refused),
 * capacity (not enough memory to build), upload (archive refused),
 * interrupted (Spawner restarted during the job).
 */
export type JobErrorCode = "invalid" | "capacity" | "upload" | "interrupted";

/**
 * A job failure tied to the phase where it happened; validation failures
 * carry the issues found in spawner.yaml or the compose file. Failures of the
 * validating phase are "invalid" unless another code is given.
 */
export class PipelineError extends Error {
  readonly code: JobErrorCode | null;

  constructor(
    readonly phase: JobPhase,
    message: string,
    readonly issues: Issue[] = [],
    code: JobErrorCode | null = null,
  ) {
    super(message);
    this.name = "PipelineError";
    this.code = code ?? (phase === "validating" ? "invalid" : null);
  }
}

interface SourceRecord {
  name: string;
  dir: string;
  origin: "git" | "upload";
  repoUrl: string;
  ref: string | null;
  commit: string | null;
  digest: string | null;
  sizeBytes: number | null;
}

type Log = (line: string) => void;

const SEED_TIMEOUT_MS = 10 * 60 * 1000;
/** How long a build waits for memory or disk before giving up. */
const GUARD_WAIT_MS = 2 * 60 * 1000;
const GUARD_POLL_MS = 5000;
/** Largest Dockerfile read to look at the order of its layers. */
const DOCKERFILE_MAX_BYTES = 256 * 1024;
/** Secret values shorter than this are not masked: they would hide common words. */
const MASKED_MIN_LENGTH = 4;

/**
 * A log that replaces secret values with stars.
 */
export function maskSecrets(log: Log, secrets: string[]): Log {
  const values = secrets.filter((secret) => secret.length >= MASKED_MIN_LENGTH).sort((a, b) => b.length - a.length);
  return values.length === 0 ? log : (line) => log(values.reduce((text, secret) => text.split(secret).join("********"), line));
}

/**
 * Executes environment jobs. A deploy goes through these phases:
 * preparing (sources), validating (manifest and compose policy), building
 * (docker compose up --build --wait), seeding (first deploy only) and
 * routing (Traefik). Any failure leaves the containers in place for
 * debugging and marks the environment failed with the phase and the reason.
 */
@Injectable()
export class PipelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SpawnerConfig,
    private readonly storage: StorageService,
    private readonly git: GitMirrorService,
    private readonly uploads: UploadService,
    private readonly compose: ComposeRunner,
    private readonly router: RouterService,
    private readonly docker: DockerService,
    private readonly logs: JobLogsService,
    private readonly systemStats: SystemStatsService,
    private readonly audit: AuditService,
    private readonly archives: LogArchiveService,
    private readonly secrets: SecretsService,
  ) {}

  async run(job: Job): Promise<void> {
    const log: Log = (line) => this.logs.append(job.id, line);
    switch (job.type) {
      case "create":
      case "update": {
        const variables = await this.projectVariables(job.environmentId);
        return this.deploy(job, maskSecrets(log, variables.secrets), job.type === "create", variables.values);
      }
      case "delete":
        return this.destroy(job, log);
      case "stop":
        return this.stop(job, log);
      case "start":
        return this.start(job, log);
      case "sleep":
        return this.sleep(job, log);
      case "wake":
        return this.wake(job, log);
      default:
        throw new PipelineError("preparing", `unknown job type "${job.type}"`);
    }
  }

  /**
   * The variables an admin set on the project of an environment, secret
   * values decrypted.
   */
  private async projectVariables(environmentId: string): Promise<{ values: Record<string, string>; secrets: string[] }> {
    const variables = await this.prisma.projectVariable.findMany({ where: { project: { environments: { some: { id: environmentId } } } } });
    const values: Record<string, string> = {};
    const secrets: string[] = [];
    for (const variable of variables) {
      values[variable.name] = variable.secret ? this.secrets.decrypt(variable.value) : variable.value;
      if (variable.secret) {
        secrets.push(values[variable.name]);
      }
    }
    return { values, secrets };
  }

  private async deploy(job: Job, log: Log, isCreate: boolean, projectVariables: Record<string, string>): Promise<void> {
    const env = await this.environment(job.environmentId);
    const payload = job.payload as unknown as DeployPayload;
    const projectName = composeProjectName(env.project.slug, env.slug);

    try {
      await this.setStatus(env.id, "preparing");
      await this.checkBuildGuards(log);

      const primaryDir = this.storage.sourceDir(env.id, PRIMARY_DIR);
      const primary = await this.prepareSource(
        { name: PRIMARY_DIR, dir: primaryDir, repoUrl: env.project.repoUrl, defaultRef: env.project.defaultRef, request: payload.primary },
        log,
      );
      const projectRoot = this.projectRoot(primaryDir, env.project.rootDir);
      const manifest = this.readManifest(projectRoot, env.project.slug, log);
      this.rejectIfIssues([...publicExposureIssues(manifest, env.project.allowPublic), ...alwaysOnIssues(manifest, env.project.allowAlwaysOn)], "spawner.yaml", log);

      const undeclared = Object.keys(payload.sources ?? {}).filter((name) => !(name in manifest.sources));
      if (undeclared.length > 0) {
        throw new PipelineError("validating", `sources not declared in spawner.yaml: ${undeclared.join(", ")}`);
      }

      const records: SourceRecord[] = [{ ...primary, name: manifest.name }];
      const sourceRoots: Record<string, string> = { [manifest.name]: projectRoot };
      for (const [name, declared] of Object.entries(manifest.sources)) {
        const dir = this.storage.sourceDir(env.id, name);
        records.push(
          await this.prepareSource(
            { name, dir, repoUrl: declared.repo, defaultRef: declared.defaultRef, request: payload.sources?.[name] ?? { origin: "git" } },
            log,
          ),
        );
        sourceRoots[name] = dir;
      }
      await this.saveSources(env.id, records);

      const { vars, hosts, issues: variableIssues } = buildVariables({
        project: env.project.slug,
        env: env.slug,
        domain: this.config.previewDomain,
        scheme: this.config.scheme,
        exposures: manifest.exposures,
        sourceRoots,
        projectVariables,
      });
      this.rejectIfIssues(variableIssues, "variables", log);

      const composePath = this.resolveInside(path.join(projectRoot, ".spawner"), manifest.compose, projectRoot, "compose file");
      const prepared = prepareCompose(fs.readFileSync(composePath, "utf8"), vars, {
        project: env.project.slug,
        env: env.slug,
        envId: env.id,
        composeDir: path.dirname(composePath),
        sourceRoots,
        exposures: manifest.exposures,
        seedServices: manifest.seed.map((step) => step.service),
        limits: {
          ...this.config.composeLimits,
          envMemoryBytes: Math.min(manifest.limits.memory ?? this.config.composeLimits.envMemoryBytes, this.config.envMemoryMaxBytes),
        },
      });
      this.rejectIfIssues(prepared.issues, "compose file", log);
      this.warnAboutLayers(prepared.document ?? {}, log);

      const renderedPath = this.storage.renderedComposePath(env.id);
      this.storage.writeAtomic(renderedPath, prepared.yaml as string);
      await this.prisma.environment.update({
        where: { id: env.id },
        data: { manifest: manifest as unknown as Prisma.InputJsonValue },
      });
      const exposures = manifest.exposures.map((exposure) => ({ ...exposure, host: hosts[exposure.name] }));
      await this.saveExposures(env.id, exposures);

      await this.setStatus(env.id, "building");
      const previousImages = isCreate ? [] : await this.imagesOf(env.id);
      if (!isCreate && payload.fresh) {
        log("Removing containers and volumes before redeploying (--fresh)");
        await this.compose.down(projectName, renderedPath, log);
      }
      log(`Building and starting ${projectName}`);
      try {
        await this.compose.up(projectName, renderedPath, log);
        if (!isCreate && prepared.servicesMountingSources.length > 0) {
          log(`Recreating ${prepared.servicesMountingSources.join(", ")}, which mount the updated sources`);
          await this.compose.recreate(projectName, renderedPath, prepared.servicesMountingSources, log);
        }
      } catch (error) {
        throw new PipelineError("building", (error as Error).message);
      }

      if (isCreate || payload.fresh || payload.reseed) {
        await this.seed(env.id, manifest, log);
      }

      await this.setStatus(env.id, "routing");
      try {
        await this.router.publish(env.id, projectName, exposures);
      } catch (error) {
        throw new PipelineError("routing", (error as Error).message);
      }
      await this.router.waitUntilServed(env.id, exposures.map((exposure) => exposure.host), log);

      await this.removeReplacedImages(env.id, projectName, previousImages, log);
      await this.dropBuildSources(env.id, records, prepared.runtimeSources, manifest.name, log);
      await this.prisma.environment.update({
        where: { id: env.id },
        data: {
          status: "ready",
          phase: null,
          error: null,
          expiresAt: this.expiry(env.expiresAt, payload.ttlSeconds ?? null, manifest),
          lastActivityAt: new Date(),
        },
      });
      exposures.forEach((exposure) => log(`Ready: ${exposure.name} ${this.config.scheme}://${exposure.host}`));
    } catch (error) {
      await this.fail(env.id, error, "preparing");
      if (error instanceof PipelineError && error.issues.length > 0) {
        await this.recordViolation(job, `${env.project.slug}/${env.slug}`, error.issues);
      }
      throw error;
    } finally {
      this.removeArchives(payload);
    }
  }

  private async destroy(job: Job, log: Log): Promise<void> {
    const env = await this.environment(job.environmentId);
    const projectName = composeProjectName(env.project.slug, env.slug);
    try {
      await this.setStatus(env.id, "deleting");
      try {
        const services = await this.archives.archive(env.id);
        if (services.length > 0) {
          log(`Kept the last logs of ${services.join(", ")} for 7 days`);
        }
      } catch (error) {
        log(`The logs could not be archived: ${(error as Error).message}`);
      }
      await this.router.unpublish(env.id, projectName);
      log(`Removing ${projectName}`);
      await this.compose.down(projectName, this.storage.renderedComposePath(env.id), log);
      const manifestName = (env.manifest as { name?: string } | null)?.name;
      for (const source of env.sources) {
        if (source.origin === "git" && source.repoUrl) {
          const dir = this.storage.sourceDir(env.id, source.name === manifestName ? PRIMARY_DIR : source.name);
          await this.git.removeWorktree(source.repoUrl, dir);
        }
      }
      await this.storage.removeTree(this.storage.envDir(env.id));
      await this.prisma.environment.update({
        where: { id: env.id },
        data: { status: "deleted", phase: null, error: null, deletedAt: new Date() },
      });
      log("Environment deleted");
    } catch (error) {
      await this.fail(env.id, error, "deleting");
      throw error;
    }
  }

  /**
   * Stops an environment until someone starts it again. Its URLs then lead
   * to a page that says so.
   */
  private async stop(job: Job, log: Log): Promise<void> {
    const env = await this.environment(job.environmentId);
    const projectName = composeProjectName(env.project.slug, env.slug);
    try {
      await this.setStatus(env.id, "stopping");
      await this.router.publishPlaceholder(env.id, projectName, env.exposures);
      await this.compose.stop(projectName, this.storage.renderedComposePath(env.id), log);
      await this.prisma.environment.update({ where: { id: env.id }, data: { status: "stopped", phase: null, error: null } });
    } catch (error) {
      await this.fail(env.id, error, "stopping");
      throw error;
    }
  }

  private async start(job: Job, log: Log): Promise<void> {
    await this.resume(job, log, "starting");
  }

  /**
   * Puts an environment to sleep: its containers stop, its volumes and
   * images stay, and its URLs lead to a page that wakes it up. The status is
   * "sleeping" from the start, so that a visit during the job queues a
   * wake-up after it.
   */
  private async sleep(job: Job, log: Log): Promise<void> {
    const env = await this.environment(job.environmentId);
    const projectName = composeProjectName(env.project.slug, env.slug);
    try {
      await this.setStatus(env.id, "sleeping");
      await this.router.publishPlaceholder(env.id, projectName, env.exposures);
      await this.compose.stop(projectName, this.storage.renderedComposePath(env.id), log);
      log("Asleep: the next visit to one of its URLs wakes it up");
    } catch (error) {
      await this.fail(env.id, error, "sleeping");
      throw error;
    }
  }

  private async wake(job: Job, log: Log): Promise<void> {
    await this.resume(job, log, "waking");
  }

  /**
   * Starts the containers of a stopped or sleeping environment again (they
   * are recreated from their images if someone removed them), then routes
   * its URLs back to them.
   */
  private async resume(job: Job, log: Log, status: "starting" | "waking"): Promise<void> {
    const env = await this.environment(job.environmentId);
    const projectName = composeProjectName(env.project.slug, env.slug);
    const file = this.storage.renderedComposePath(env.id);
    try {
      await this.setStatus(env.id, status);
      const containers = await this.docker.listEnvironmentContainers(env.id);
      if (containers.length > 0) {
        await this.compose.start(projectName, file, log);
      } else {
        log("Its containers are gone: recreating them from their images");
        await this.compose.upWithoutBuild(projectName, file, log);
      }
      await this.router.publish(env.id, projectName, env.exposures);
      await this.router.waitUntilServed(env.id, env.exposures.map((exposure) => exposure.host), log);
      await this.prisma.environment.update({ where: { id: env.id }, data: { status: "ready", phase: null, error: null, lastActivityAt: new Date() } });
    } catch (error) {
      await this.fail(env.id, error, status);
      throw error;
    }
  }

  private async prepareSource(
    spec: { name: string; dir: string; repoUrl: string; defaultRef: string; request: SourceRequest },
    log: Log,
  ): Promise<SourceRecord> {
    const label = spec.name === PRIMARY_DIR ? "project repository" : `source "${spec.name}"`;
    if (spec.request.origin === "upload") {
      if (!spec.request.archive) {
        throw new PipelineError("preparing", `no archive was uploaded for the ${label}`);
      }
      log(`Extracting the uploaded ${label}`);
      try {
        const result = await this.uploads.extract(spec.request.archive, spec.dir);
        log(`Extracted ${result.files} files (${Math.round(result.sizeBytes / 1024)} KiB)`);
        return { name: spec.name, dir: spec.dir, origin: "upload", repoUrl: spec.repoUrl, ref: null, commit: null, digest: result.digest, sizeBytes: result.sizeBytes };
      } catch (error) {
        throw new PipelineError("preparing", `${label}: ${(error as Error).message}`, [], error instanceof UploadRejectedError ? "upload" : null);
      }
    }

    const ref = spec.request.ref || spec.defaultRef;
    try {
      const { commit } = await this.git.checkout(spec.repoUrl, ref, spec.dir, log);
      return { name: spec.name, dir: spec.dir, origin: "git", repoUrl: spec.repoUrl, ref, commit, digest: null, sizeBytes: await directorySize(spec.dir) };
    } catch (error) {
      throw new PipelineError("preparing", `${label}: ${(error as Error).message}`);
    }
  }

  private projectRoot(primaryDir: string, rootDir: string): string {
    const root = path.resolve(primaryDir, rootDir);
    const real = this.realpath(root);
    if (!real || !isInside(real, this.realpath(primaryDir) ?? primaryDir)) {
      throw new PipelineError("validating", `the project root directory "${rootDir}" does not exist in the repository`);
    }
    return root;
  }

  private readManifest(projectRoot: string, projectSlug: string, log: Log): Manifest {
    const manifestPath = this.resolveInside(projectRoot, MANIFEST_PATH, projectRoot, "spawner.yaml");
    const { manifest, issues } = parseManifest(fs.readFileSync(manifestPath, "utf8"));
    this.rejectIfIssues(issues, "spawner.yaml", log);
    if (manifest!.project !== projectSlug) {
      throw new PipelineError(
        "validating",
        `spawner.yaml declares project "${manifest!.project}", but this environment belongs to "${projectSlug}"`,
      );
    }
    return manifest!;
  }

  /**
   * Refused manifests and compose files go to the audit trail, under the
   * user who sent them.
   */
  private async recordViolation(job: Job, target: string, issues: Issue[]): Promise<void> {
    const user = job.triggeredById ? await this.prisma.user.findUnique({ where: { id: job.triggeredById } }) : null;
    await this.audit.record(null, "env.policy_violation", {
      userId: user?.id,
      actorName: user?.name ?? "bootstrap token",
      target,
      details: { issues: issues.map((issue) => `${issue.code} ${issue.path}`.trim()) },
    });
  }

  private rejectIfIssues(issues: Issue[], what: string, log: Log): void {
    if (issues.length === 0) {
      return;
    }
    log(`${what} rejected:`);
    issues.forEach((issue) => log(`  ${formatIssue(issue)}`));
    throw new PipelineError("validating", `${what} rejected (${issues.length} issue${issues.length > 1 ? "s" : ""})`, issues);
  }

  /**
   * Resolves a file that must exist inside root, symlinks included.
   */
  private resolveInside(baseDir: string, relative: string, root: string, what: string): string {
    const real = this.realpath(path.resolve(baseDir, relative));
    if (!real) {
      throw new PipelineError("validating", `${what} not found (${path.relative(root, path.resolve(baseDir, relative))})`);
    }
    if (!isInside(real, this.realpath(root) ?? root)) {
      throw new PipelineError("validating", `${what} resolves outside the repository`);
    }
    return real;
  }

  private async seed(environmentId: string, manifest: Manifest, log: Log): Promise<void> {
    if (manifest.seed.length === 0) {
      return;
    }
    await this.setStatus(environmentId, "seeding");
    for (const step of manifest.seed) {
      const container = await this.docker.findServiceContainer(environmentId, step.service);
      if (!container || container.State !== "running") {
        throw new PipelineError("seeding", `service "${step.service}" is not running`);
      }
      log(`Seed (${step.service}): ${step.run.join(" ")}`);
      const result = await this.docker.exec(container.Id, step.run, { timeoutMs: SEED_TIMEOUT_MS, maxOutputBytes: 1024 * 1024 });
      `${result.stdout}${result.stderr}`
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .forEach((line) => log(`  ${line}`));
      if (result.timedOut) {
        throw new PipelineError("seeding", `seed step timed out after ${SEED_TIMEOUT_MS / 60000} minutes`);
      }
      if (result.exitCode !== 0) {
        throw new PipelineError("seeding", `seed step "${step.run.join(" ")}" exited with code ${result.exitCode}`);
      }
    }
  }

  /**
   * The guards of a build: enough memory available and enough disk free. A
   * build waits up to two minutes for another one to end and give memory
   * back, then gives up.
   */
  private async checkBuildGuards(log: Log): Promise<void> {
    const deadline = Date.now() + GUARD_WAIT_MS;
    let waiting = false;
    for (;;) {
      const memory = this.config.memoryCheckEnabled ? this.systemStats.checkMemoryAvailability(this.config.minFreeMemoryBytes) : null;
      const disk = this.systemStats.checkDiskAvailability(this.config.dataDir, this.config.minFreeDiskBytes);
      const failing = [memory, disk].filter((check) => check && !check.available).map((check) => check!.message);
      if (failing.length === 0) {
        [memory, disk].forEach((check) => check && log(check.message));
        return;
      }
      if (Date.now() > deadline) {
        throw new PipelineError("preparing", failing.join("; "), [], "capacity");
      }
      if (!waiting) {
        failing.forEach((message) => log(`${message}: waiting up to ${GUARD_WAIT_MS / 60000} minutes`));
        waiting = true;
      }
      await new Promise((resolve) => setTimeout(resolve, GUARD_POLL_MS));
    }
  }

  /**
   * Warns about Dockerfiles that copy the whole code before installing
   * their dependencies: environments could share that layer.
   */
  private warnAboutLayers(document: Record<string, unknown>, log: Log): void {
    const services = (document.services ?? {}) as Record<string, { build?: { context?: string; dockerfile?: string } }>;
    for (const [name, service] of Object.entries(services)) {
      if (!service.build?.context) {
        continue;
      }
      const dockerfile = service.build.dockerfile ?? path.join(service.build.context, "Dockerfile");
      let text: string;
      try {
        if (fs.statSync(dockerfile).size > DOCKERFILE_MAX_BYTES) {
          continue;
        }
        text = fs.readFileSync(dockerfile, "utf8");
      } catch {
        continue;
      }
      for (const warning of dockerfileLayerWarnings(text)) {
        log(`Warning (${name}): ${warning.message}`);
        log(`  ${warning.hint}`);
      }
    }
  }

  /** Images the containers of an environment run, before a rebuild. */
  private async imagesOf(environmentId: string): Promise<string[]> {
    const containers = await this.docker.listEnvironmentContainers(environmentId).catch(() => []);
    return [...new Set(containers.map((container) => container.ImageID))];
  }

  /**
   * Removes the images of the previous build that an update replaced, so
   * that old builds do not pile up. Only images Spawner built for this
   * environment go (pulled images, such as a database's, stay), and only
   * when no container runs them.
   */
  private async removeReplacedImages(environmentId: string, composeProject: string, previous: string[], log: Log): Promise<void> {
    if (previous.length === 0) {
      return;
    }
    const current = new Set(await this.imagesOf(environmentId));
    for (const image of previous.filter((id) => !current.has(id))) {
      try {
        const info = await this.docker.client.getImage(image).inspect();
        const labels = info.Config?.Labels ?? {};
        if (labels["dev.spawner.env"] !== environmentId && labels["com.docker.compose.project"] !== composeProject) {
          continue;
        }
        await this.docker.client.getImage(image).remove();
        log(`Removed the image of the previous build (${Math.round((info.Size ?? 0) / 1024 / 1024)} MiB)`);
      } catch {
        // Still used elsewhere, or already gone.
      }
    }
  }

  /**
   * Removes the code of the sources the environment no longer needs: it was
   * only needed to build. A source mounted into a service, or holding an
   * env_file, stays. Any rebuild checks out or receives the sources again.
   */
  private async dropBuildSources(environmentId: string, records: SourceRecord[], runtimeSources: string[], primaryName: string, log: Log): Promise<void> {
    const dropped: string[] = [];
    for (const record of records) {
      if (runtimeSources.includes(record.name)) {
        continue;
      }
      try {
        if (record.origin === "git") {
          await this.git.removeWorktree(record.repoUrl, record.dir);
        } else {
          await this.storage.removeTree(record.dir);
        }
        await this.prisma.environmentSource.updateMany({ where: { environmentId, name: record.name }, data: { onDisk: false } });
        dropped.push(record.name === primaryName ? `${record.name} (this repository)` : record.name);
      } catch (error) {
        log(`The code of ${record.name} could not be removed: ${(error as Error).message}`);
      }
    }
    if (dropped.length > 0) {
      log(`Removed the code of ${dropped.join(", ")}: only the build needed it`);
    }
  }

  /**
   * Expiry of a deployed environment: now plus the lifetime asked for with
   * the deploy, or the manifest's, or the default, within the maximum. A
   * deploy without an explicit lifetime never shortens an extension.
   */
  private expiry(current: Date | null, requestedSeconds: number | null, manifest: Manifest): Date {
    const seconds = Math.min(requestedSeconds ?? manifest.ttl ?? this.config.envTtlSeconds, this.config.envTtlMaxSeconds);
    const expiresAt = new Date(Date.now() + seconds * 1000);
    return requestedSeconds === null && current && current > expiresAt ? current : expiresAt;
  }

  private async saveSources(environmentId: string, records: SourceRecord[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.environmentSource.deleteMany({ where: { environmentId, name: { notIn: records.map((record) => record.name) } } }),
      ...records.map((record) => {
        const data = {
          origin: record.origin,
          repoUrl: record.repoUrl,
          ref: record.ref,
          commit: record.commit,
          digest: record.digest,
          sizeBytes: record.sizeBytes === null ? null : BigInt(record.sizeBytes),
        };
        return this.prisma.environmentSource.upsert({
          where: { environmentId_name: { environmentId, name: record.name } },
          create: { environmentId, name: record.name, ...data },
          update: data,
        });
      }),
    ]);
  }

  private async saveExposures(
    environmentId: string,
    exposures: { name: string; service: string; port: number; host: string; entrypoint: boolean; auth: string }[],
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.exposure.deleteMany({ where: { environmentId } }),
      this.prisma.exposure.createMany({ data: exposures.map((exposure) => ({ environmentId, ...exposure })) }),
    ]);
  }

  private async setStatus(environmentId: string, status: string): Promise<void> {
    await this.prisma.environment.update({ where: { id: environmentId }, data: { status, phase: null, error: null } });
  }

  /**
   * Marks an environment failed with the phase and the reason. One that
   * never had an expiry gets one, so that a failed creation does not stay
   * forever.
   */
  private async fail(environmentId: string, error: unknown, defaultPhase: JobPhase): Promise<void> {
    const phase = error instanceof PipelineError ? error.phase : defaultPhase;
    const current = await this.prisma.environment.findUnique({ where: { id: environmentId }, select: { expiresAt: true } });
    await this.prisma.environment.update({
      where: { id: environmentId },
      data: {
        status: "failed",
        phase,
        error: ((error as Error).message ?? String(error)).slice(0, 4000),
        ...(current?.expiresAt ? {} : { expiresAt: new Date(Date.now() + this.config.envTtlSeconds * 1000) }),
      },
    });
  }

  private removeArchives(payload: DeployPayload | null): void {
    payloadArchives(payload).forEach((archive) => fs.rmSync(archive, { force: true }));
  }

  private environment(id: string) {
    return this.prisma.environment.findUniqueOrThrow({
      where: { id },
      include: { project: true, sources: true, exposures: true },
    });
  }

  private realpath(target: string): string | null {
    try {
      return fs.realpathSync.native(target);
    } catch {
      return null;
    }
  }
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
