import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Environment, type EnvironmentSource, type Exposure, type Job, type Project } from "@prisma/client";
import { slugIssue } from "@spawner/core";
import { sanitizeGitBranch } from "@spawner/utils";
import { DockerService } from "../../common/docker.service";
import { PrismaService } from "../../common/prisma.service";
import { JobQueueService, type JobType } from "../engine/job-queue.service";
import type { DeployPayload, SourceRequest } from "../engine/pipeline.service";
import { SpawnerConfig } from "../engine/spawner.config";
import { StatsService } from "../stats/stats.service";

const EXEC_DEFAULT_SECONDS = 120;
const EXEC_MAX_SECONDS = 600;
const EXEC_MAX_OUTPUT_BYTES = 1024 * 1024;
const STATS_MAX_MINUTES = 7 * 24 * 60;

export interface DeployRequest {
  primary: SourceRequest;
  sources: Record<string, SourceRequest>;
  fresh?: boolean;
  reseed?: boolean;
}

type EnvironmentWithRelations = Environment & {
  project: Project;
  sources: EnvironmentSource[];
  exposures: Exposure[];
  jobs: Job[];
};

const INCLUDE = {
  project: true,
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
  ) {}

  async list(projectSlug?: string) {
    const environments = await this.prisma.environment.findMany({
      where: { deletedAt: null, ...(projectSlug ? { project: { slug: projectSlug } } : {}) },
      orderBy: { createdAt: "desc" },
      include: INCLUDE,
    });
    return environments.map((environment) => this.present(environment));
  }

  async get(id: string) {
    return this.present(await this.find(id));
  }

  /**
   * Finds a live environment by project and name, as the CLI refers to them.
   */
  async getBySlug(projectSlug: string, slug: string) {
    const environment = await this.prisma.environment.findFirst({
      where: { deletedAt: null, slug, project: { slug: projectSlug } },
      include: INCLUDE,
    });
    if (!environment) {
      throw new NotFoundException(`environment "${slug}" not found in project "${projectSlug}"`);
    }
    return this.present(environment);
  }

  async create(input: { project: string; env: string; request: DeployRequest; createdVia: string; actorId: number | null }) {
    const issue = slugIssue("env", input.env, "env");
    if (issue) {
      throw new BadRequestException(issue.hint ? `${issue.message} (${issue.hint})` : issue.message);
    }
    this.validateRequest(input.request);
    const project = await this.prisma.project.findUnique({ where: { slug: input.project } });
    if (!project) {
      throw new NotFoundException(`project "${input.project}" not found`);
    }

    let environment: Environment;
    try {
      environment = await this.prisma.environment.create({
        data: {
          projectId: project.id,
          slug: input.env,
          status: "queued",
          ownerId: input.actorId,
          createdVia: ["ui", "cli", "mcp", "api"].includes(input.createdVia) ? input.createdVia : "api",
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(`environment "${input.env}" already exists in project "${input.project}"; update it instead`);
      }
      throw error;
    }

    const job = await this.queue.enqueue(environment.id, "create", this.payload(input.request), input.actorId);
    return { environment: await this.get(environment.id), job: this.presentJob(job) };
  }

  async update(id: string, request: DeployRequest, actorId: number | null) {
    this.validateRequest(request);
    const environment = await this.find(id);
    this.ensureNotDeleting(environment);
    const job = await this.queue.enqueue(environment.id, "update", this.payload(request), actorId);
    return { environment: await this.get(environment.id), job: this.presentJob(job) };
  }

  async enqueue(id: string, type: Extract<JobType, "delete" | "stop" | "start">, actorId: number | null) {
    const environment = await this.find(id);
    this.ensureNotDeleting(environment);
    const job = await this.queue.enqueue(environment.id, type, null, actorId);
    return { environment: this.present(environment), job: this.presentJob(job) };
  }

  /**
   * Runs a command in a service with an argument array (no shell) and
   * returns its exit code and outputs.
   */
  async exec(id: string, body: { service?: unknown; argv?: unknown; timeoutSec?: unknown }) {
    if (typeof body.service !== "string" || !Array.isArray(body.argv) || body.argv.length === 0 || !body.argv.every((item) => typeof item === "string")) {
      throw new BadRequestException("expected { service: string, argv: string[] }");
    }
    const timeoutSec = typeof body.timeoutSec === "number" ? Math.min(Math.max(body.timeoutSec, 1), EXEC_MAX_SECONDS) : EXEC_DEFAULT_SECONDS;
    const container = await this.runningContainer(id, body.service);
    return this.docker.exec(container, body.argv as string[], { timeoutMs: timeoutSec * 1000, maxOutputBytes: EXEC_MAX_OUTPUT_BYTES });
  }

  async logs(id: string, service: string, tail: number) {
    const environment = await this.find(id);
    const container = await this.docker.findServiceContainer(environment.id, service);
    if (!container) {
      throw new NotFoundException(`service "${service}" has no container`);
    }
    return this.docker.logs(container.Id, { tail: Math.min(Math.max(tail, 1), 5000) });
  }

  /**
   * The environment's containers, one per compose service, with their state.
   */
  async services(id: string) {
    const environment = await this.find(id);
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
  async usage(id: string, minutes: number) {
    const environment = await this.find(id);
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

  private async runningContainer(id: string, service: string): Promise<string> {
    const environment = await this.find(id);
    const container = await this.docker.findServiceContainer(environment.id, service);
    if (!container || container.State !== "running") {
      throw new ConflictException(`service "${service}" is not running`);
    }
    return container.Id;
  }

  private async find(id: string): Promise<EnvironmentWithRelations> {
    const environment = await this.prisma.environment.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
    if (!environment) {
      throw new NotFoundException(`environment "${id}" not found`);
    }
    return environment;
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
      ownerId: environment.ownerId,
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
      createdAt: environment.createdAt,
      updatedAt: environment.updatedAt,
    };
  }
}
