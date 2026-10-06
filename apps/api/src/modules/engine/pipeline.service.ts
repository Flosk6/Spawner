import { Injectable } from "@nestjs/common";
import type { Job, Prisma } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import {
  buildVariables,
  composeProjectName,
  formatIssue,
  MANIFEST_PATH,
  parseManifest,
  prepareCompose,
  type Issue,
  type Manifest,
} from "@spawner/core";
import { DockerService } from "../../common/docker.service";
import { PrismaService } from "../../common/prisma.service";
import { SystemStatsService } from "../system/system-stats.service";
import { ComposeRunner } from "./compose-runner.service";
import { GitMirrorService } from "./git-mirror.service";
import { JobLogsService } from "./job-logs.service";
import { AuditService } from "../audit/audit.service";
import { RouterService } from "./router.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { StorageService } from "./storage.service";
import { UploadService } from "./upload.service";

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
}

export type JobPhase = "preparing" | "validating" | "building" | "seeding" | "routing" | "deleting" | "stopping" | "starting";

/**
 * A job failure tied to the phase where it happened; validation failures
 * carry the issues found in spawner.yaml or the compose file.
 */
export class PipelineError extends Error {
  constructor(
    readonly phase: JobPhase,
    message: string,
    readonly issues: Issue[] = [],
  ) {
    super(message);
    this.name = "PipelineError";
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
  ) {}

  async run(job: Job): Promise<void> {
    const log: Log = (line) => this.logs.append(job.id, line);
    switch (job.type) {
      case "create":
        return this.deploy(job, log, true);
      case "update":
        return this.deploy(job, log, false);
      case "delete":
        return this.destroy(job, log);
      case "stop":
        return this.stop(job, log);
      case "start":
        return this.start(job, log);
      default:
        throw new PipelineError("preparing", `unknown job type "${job.type}"`);
    }
  }

  private async deploy(job: Job, log: Log, isCreate: boolean): Promise<void> {
    const env = await this.environment(job.environmentId);
    const payload = job.payload as unknown as DeployPayload;
    const projectName = composeProjectName(env.project.slug, env.slug);

    try {
      await this.setStatus(env.id, "preparing");
      this.checkMemory(log);

      const primaryDir = this.storage.sourceDir(env.id, PRIMARY_DIR);
      const primary = await this.prepareSource(
        { name: PRIMARY_DIR, dir: primaryDir, repoUrl: env.project.repoUrl, defaultRef: env.project.defaultRef, request: payload.primary },
        log,
      );
      const projectRoot = this.projectRoot(primaryDir, env.project.rootDir);
      const manifest = this.readManifest(projectRoot, env.project.slug, log);

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

      const renderedPath = this.storage.renderedComposePath(env.id);
      this.storage.writeAtomic(renderedPath, prepared.yaml as string);
      await this.prisma.environment.update({
        where: { id: env.id },
        data: { manifest: manifest as unknown as Prisma.InputJsonValue },
      });
      const exposures = manifest.exposures.map((exposure) => ({ ...exposure, host: hosts[exposure.name] }));
      await this.saveExposures(env.id, exposures);

      await this.setStatus(env.id, "building");
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
      await this.router.waitUntilServed(exposures.map((exposure) => exposure.host), log);

      const ttlSeconds = Math.min(manifest.ttl ?? this.config.envTtlSeconds, this.config.envTtlMaxSeconds);
      await this.prisma.environment.update({
        where: { id: env.id },
        data: { status: "ready", phase: null, error: null, expiresAt: new Date(Date.now() + ttlSeconds * 1000) },
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

  private async stop(job: Job, log: Log): Promise<void> {
    const env = await this.environment(job.environmentId);
    const projectName = composeProjectName(env.project.slug, env.slug);
    try {
      await this.setStatus(env.id, "stopping");
      await this.router.unpublish(env.id, projectName);
      await this.compose.stop(projectName, this.storage.renderedComposePath(env.id), log);
      await this.prisma.environment.update({ where: { id: env.id }, data: { status: "stopped", phase: null, error: null } });
    } catch (error) {
      await this.fail(env.id, error, "stopping");
      throw error;
    }
  }

  private async start(job: Job, log: Log): Promise<void> {
    const env = await this.environment(job.environmentId);
    const projectName = composeProjectName(env.project.slug, env.slug);
    try {
      await this.setStatus(env.id, "starting");
      await this.compose.start(projectName, this.storage.renderedComposePath(env.id), log);
      await this.router.publish(env.id, projectName, env.exposures);
      await this.router.waitUntilServed(env.exposures.map((exposure) => exposure.host), log);
      await this.prisma.environment.update({ where: { id: env.id }, data: { status: "ready", phase: null, error: null } });
    } catch (error) {
      await this.fail(env.id, error, "starting");
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
        throw new PipelineError("preparing", `${label}: ${(error as Error).message}`);
      }
    }

    const ref = spec.request.ref || spec.defaultRef;
    try {
      const { commit } = await this.git.checkout(spec.repoUrl, ref, spec.dir, log);
      return { name: spec.name, dir: spec.dir, origin: "git", repoUrl: spec.repoUrl, ref, commit, digest: null, sizeBytes: null };
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

  private checkMemory(log: Log): void {
    if (!this.config.memoryCheckEnabled) {
      return;
    }
    const check = this.systemStats.checkMemoryAvailability(this.config.minFreeMemoryBytes);
    log(check.message);
    if (!check.available) {
      throw new PipelineError("preparing", check.message);
    }
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

  private async fail(environmentId: string, error: unknown, defaultPhase: JobPhase): Promise<void> {
    const phase = error instanceof PipelineError ? error.phase : defaultPhase;
    await this.prisma.environment.update({
      where: { id: environmentId },
      data: { status: "failed", phase, error: ((error as Error).message ?? String(error)).slice(0, 4000) },
    });
  }

  private removeArchives(payload: DeployPayload | null): void {
    const requests = [payload?.primary, ...Object.values(payload?.sources ?? {})];
    for (const request of requests) {
      if (request?.archive) {
        fs.rmSync(request.archive, { force: true });
      }
    }
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
