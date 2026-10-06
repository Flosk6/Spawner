import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Environment, type EnvironmentSource, type Exposure, type Job, type Project, type User } from "@prisma/client";
import { slugIssue } from "@spawner/core";
import { sanitizeGitBranch } from "@spawner/utils";
import { assertCanAct, assertInProject, type Actor } from "../../common/actor";
import { DockerService } from "../../common/docker.service";
import { PrismaService } from "../../common/prisma.service";
import { JobQueueService, type JobType } from "../engine/job-queue.service";
import type { DeployPayload, SourceRequest } from "../engine/pipeline.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { AuditService } from "../audit/audit.service";
import { StatsService } from "../stats/stats.service";

const EXEC_DEFAULT_SECONDS = 120;
const EXEC_MAX_SECONDS = 600;
const EXEC_MAX_OUTPUT_BYTES = 1024 * 1024;
const STATS_MAX_MINUTES = 7 * 24 * 60;
const AUDITED_COMMAND_LENGTH = 200;

export interface DeployRequest {
  primary: SourceRequest;
  sources: Record<string, SourceRequest>;
  fresh?: boolean;
  reseed?: boolean;
}

type EnvironmentWithRelations = Environment & {
  project: Project;
  owner: User | null;
  sources: EnvironmentSource[];
  exposures: Exposure[];
  jobs: Job[];
};

const INCLUDE = {
  project: true,
  owner: true,
  sources: { orderBy: { name: "asc" } },
  exposures: { orderBy: { name: "asc" } },
  jobs: { orderBy: { createdAt: "desc" }, take: 1 },
} satisfies Prisma.EnvironmentInclude;

/**
 * Environments as the API exposes them. Every change goes through a job; this
 * service validates the request, records it and queues the job.
 */
@Injectable()
export class EnvironmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueueService,
    private readonly config: SpawnerConfig,
    private readonly docker: DockerService,
    private readonly stats: StatsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Live environments, newest first, within the project a token is
   * restricted to.
   */
  async list(actor: Actor, filter: { project?: string; mine?: boolean }) {
    const environments = await this.prisma.environment.findMany({
      where: {
        deletedAt: null,
        ...(filter.project ? { project: { slug: filter.project } } : {}),
        ...(actor.projectId ? { projectId: actor.projectId } : {}),
        ...(filter.mine ? { ownerId: actor.user?.id ?? -1 } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: INCLUDE,
    });
    return environments.map((environment) => this.present(environment));
  }

  async get(actor: Actor, id: string) {
    return this.present(await this.find(actor, id));
  }

  /**
   * Finds a live environment by project and name, as the CLI refers to them.
   */
  async getBySlug(actor: Actor, projectSlug: string, slug: string) {
    const environment = await this.prisma.environment.findFirst({
      where: { deletedAt: null, slug, project: { slug: projectSlug } },
      include: INCLUDE,
    });
    if (!environment) {
      throw new NotFoundException(`environment "${slug}" not found in project "${projectSlug}"`);
    }
    assertInProject(actor, environment.projectId);
    return this.present(environment);
  }

  /**
   * Records a new environment owned by the actor, then queues its creation.
   */
  async create(actor: Actor, input: { project: string; env: string; request: DeployRequest; createdVia: string }) {
    const issue = slugIssue("env", input.env, "env");
    if (issue) {
      throw new BadRequestException(issue.hint ? `${issue.message} (${issue.hint})` : issue.message);
    }
    this.validateRequest(input.request);
    const project = await this.prisma.project.findUnique({ where: { slug: input.project } });
    if (!project) {
      throw new NotFoundException(`project "${input.project}" not found`);
    }
    assertInProject(actor, project.id);

    let environment: Environment;
    try {
      environment = await this.prisma.environment.create({
        data: {
          projectId: project.id,
          slug: input.env,
          status: "queued",
          ownerId: actor.user?.id ?? null,
          createdVia: ["ui", "cli", "mcp", "api"].includes(input.createdVia) ? input.createdVia : "api",
          tokenName: actor.via === "token" ? actor.tokenName : null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(`environment "${input.env}" already exists in project "${input.project}"; update it instead`);
      }
      throw error;
    }

    const job = await this.queue.enqueue(environment.id, "create", this.payload(input.request), actor.user?.id ?? null);
    await this.audit.record(actor, "env.create", { target: `${project.slug}/${environment.slug}`, details: this.auditSources(input.request) });
    return { environment: await this.get(actor, environment.id), job: this.presentJob(job) };
  }

  async update(actor: Actor, id: string, request: DeployRequest) {
    this.validateRequest(request);
    const environment = await this.find(actor, id);
    assertCanAct(actor, "envs:write", environment);
    this.ensureNotDeleting(environment);
    const job = await this.queue.enqueue(environment.id, "update", this.payload(request), actor.user?.id ?? null);
    await this.audit.record(actor, "env.update", { target: this.label(environment), details: { ...this.auditSources(request), fresh: request.fresh, reseed: request.reseed } });
    return { environment: await this.get(actor, environment.id), job: this.presentJob(job) };
  }

  async enqueue(actor: Actor, id: string, type: Extract<JobType, "delete" | "stop" | "start">) {
    const environment = await this.find(actor, id);
    assertCanAct(actor, "envs:write", environment);
    this.ensureNotDeleting(environment);
    const job = await this.queue.enqueue(environment.id, type, null, actor.user?.id ?? null);
    await this.audit.record(actor, `env.${type}`, { target: this.label(environment) });
    return { environment: this.present(environment), job: this.presentJob(job) };
  }

  /**
   * Runs a command in a service with an argument array (no shell) and
   * returns its exit code and outputs. Members run commands in their own
   * environments only.
   */
  async exec(actor: Actor, id: string, body: { service?: unknown; argv?: unknown; timeoutSec?: unknown }) {
    if (typeof body.service !== "string" || !Array.isArray(body.argv) || body.argv.length === 0 || !body.argv.every((item) => typeof item === "string")) {
      throw new BadRequestException("expected { service: string, argv: string[] }");
    }
    const timeoutSec = typeof body.timeoutSec === "number" ? Math.min(Math.max(body.timeoutSec, 1), EXEC_MAX_SECONDS) : EXEC_DEFAULT_SECONDS;
    const environment = await this.find(actor, id);
    assertCanAct(actor, "envs:exec", environment);
    const container = await this.runningContainer(environment, body.service);
    const command = (body.argv as string[]).join(" ");
    await this.audit.record(actor, "env.exec", {
      target: this.label(environment),
      details: { service: body.service, command: command.length > AUDITED_COMMAND_LENGTH ? `${command.slice(0, AUDITED_COMMAND_LENGTH)}...` : command },
    });
    return this.docker.exec(container, body.argv as string[], { timeoutMs: timeoutSec * 1000, maxOutputBytes: EXEC_MAX_OUTPUT_BYTES });
  }

  async logs(actor: Actor, id: string, service: string, tail: number) {
    const environment = await this.find(actor, id);
    const container = await this.docker.findServiceContainer(environment.id, service);
    if (!container) {
      throw new NotFoundException(`service "${service}" has no container`);
    }
    return this.docker.logs(container.Id, { tail: Math.min(Math.max(tail, 1), 5000) });
  }

  /**
   * The environment's containers, one per compose service, with their state.
   */
  async services(actor: Actor, id: string) {
    const environment = await this.find(actor, id);
    const containers = await this.docker.listEnvironmentContainers(environment.id);
    return containers
      .map((container) => ({
        name: container.Labels["com.docker.compose.service"],
        state: container.State,
        status: container.Status,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * CPU and memory of the environment over the last minutes, one point per
   * minute while it runs.
   */
  async usage(actor: Actor, id: string, minutes: number) {
    const environment = await this.find(actor, id);
    const span = Math.min(Math.max(minutes, 5), STATS_MAX_MINUTES);
    const points = await this.stats.getStatsHistory(environment.id, new Date(Date.now() - span * 60_000));
    return points.map((point) => ({
      time: point.time,
      cpuPercent: Number(point.cpuPercent),
      memoryUsageGB: Number(point.memoryUsageGB),
      memoryLimitGB: Number(point.memoryLimitGB),
    }));
  }

  presentJob(job: Job) {
    return {
      id: job.id,
      environmentId: job.environmentId,
      type: job.type,
      status: job.status,
      phase: job.phase,
      error: job.error,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    };
  }

  private async runningContainer(environment: Environment, service: string): Promise<string> {
    const container = await this.docker.findServiceContainer(environment.id, service);
    if (!container || container.State !== "running") {
      throw new ConflictException(`service "${service}" is not running`);
    }
    return container.Id;
  }

  private async find(actor: Actor, id: string): Promise<EnvironmentWithRelations> {
    const environment = await this.prisma.environment.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
    if (!environment) {
      throw new NotFoundException(`environment "${id}" not found`);
    }
    assertInProject(actor, environment.projectId);
    return environment;
  }

  private label(environment: EnvironmentWithRelations): string {
    return `${environment.project.slug}/${environment.slug}`;
  }

  /** Where each source of a deploy comes from, for the audit trail. */
  private auditSources(request: DeployRequest): Record<string, unknown> {
    const describe = (source: SourceRequest) => (source.origin === "upload" ? "upload" : (source.ref ?? "default"));
    return { primary: describe(request.primary), sources: Object.fromEntries(Object.entries(request.sources).map(([name, source]) => [name, describe(source)])) };
  }

  private ensureNotDeleting(environment: Environment): void {
    if (environment.status === "deleting") {
      throw new ConflictException("the environment is being deleted");
    }
  }

  private validateRequest(request: DeployRequest): void {
    const entries: [string, SourceRequest][] = [["primary", request.primary], ...Object.entries(request.sources)];
    for (const [name, source] of entries) {
      if (name !== "primary") {
        const issue = slugIssue("source", name, "source");
        if (issue) {
          throw new BadRequestException(`source "${name}": ${issue.message}`);
        }
      }
      if (source.origin !== "git" && source.origin !== "upload") {
        throw new BadRequestException(`source "${name}": origin must be "git" or "upload"`);
      }
      if (source.origin === "upload" && !source.archive) {
        throw new BadRequestException(`source "${name}": no archive uploaded`);
      }
      if (source.ref !== undefined) {
        try {
          sanitizeGitBranch(source.ref);
        } catch (error) {
          throw new BadRequestException(`source "${name}": ${(error as Error).message}`);
        }
      }
    }
  }

  private payload(request: DeployRequest): DeployPayload {
    return { primary: request.primary, sources: request.sources, fresh: request.fresh === true, reseed: request.reseed === true };
  }

  private present(environment: EnvironmentWithRelations) {
    const urls = Object.fromEntries(environment.exposures.map((exposure) => [exposure.name, `${this.config.scheme}://${exposure.host}`]));
    const entrypoint = environment.exposures.find((exposure) => exposure.entrypoint);
    const primarySource = (environment.manifest as { name?: string } | null)?.name;
    return {
      id: environment.id,
      project: environment.project.slug,
      slug: environment.slug,
      status: environment.status,
      phase: environment.phase,
      error: environment.error,
      createdVia: environment.createdVia,
      owner: environment.owner ? { id: environment.owner.id, name: environment.owner.name } : null,
      tokenName: environment.tokenName,
      url: entrypoint ? urls[entrypoint.name] : null,
      urls,
      exposures: environment.exposures.map(({ name, service, port, host, entrypoint: isEntrypoint, auth }) => ({
        name,
        service,
        port,
        host,
        entrypoint: isEntrypoint,
        auth,
      })),
      sources: environment.sources.map((source) => ({
        name: source.name,
        primary: source.name === primarySource,
        origin: source.origin,
        repoUrl: source.repoUrl,
        ref: source.ref,
        commit: source.commit,
        digest: source.digest,
        sizeBytes: source.sizeBytes === null ? null : Number(source.sizeBytes),
      })),
      lastJob: environment.jobs[0] ? this.presentJob(environment.jobs[0]) : null,
      expiresAt: environment.expiresAt,
      lastActivityAt: environment.lastActivityAt,
      createdAt: environment.createdAt,
      updatedAt: environment.updatedAt,
    };
  }
}
