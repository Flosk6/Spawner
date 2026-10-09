import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Environment, type EnvironmentSource, type Exposure, type Job, type Project, type User } from "@prisma/client";
import { ErrorLineFilter, matchesGrep, parseDuration, slugIssue, type Manifest } from "@spawner/core";
import { sanitizeGitBranch } from "@spawner/utils";
import type Docker from "dockerode";
import { assertCanAct, assertInProject, describeActor, type Actor } from "../../common/actor";
import { LimitReachedException } from "../../common/limit-reached";
import type { RawLogLine } from "../../common/docker-logs";
import { DockerService } from "../../common/docker.service";
import { PrismaService } from "../../common/prisma.service";
import { JobQueueService, type JobType } from "../engine/job-queue.service";
import { payloadArchives, type DeployPayload, type SourceRequest } from "../engine/pipeline.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { AuditService } from "../audit/audit.service";
import { LogArchiveService } from "../engine/log-archive.service";
import { ActivityService } from "../lifecycle/activity.service";
import { idleSecondsOf } from "../lifecycle/lifecycle.service";
import { MetricsCollector } from "../supervision/metrics-collector.service";
import { UsageService } from "../supervision/usage.service";
import { TimelineService } from "../timeline/timeline.service";

const EXEC_DEFAULT_SECONDS = 120;
export const EXEC_MAX_SECONDS = 600;
export const EXEC_MAX_OUTPUT_BYTES = 1024 * 1024;
export const EXEC_MAX_STDIN_BYTES = 1024 * 1024;
/** A deleted environment stays readable this long, with its archived logs. */
export const DELETED_VISIBLE_MS = 7 * 86_400_000;
const AUDITED_COMMAND_LENGTH = 200;
const LOG_DEFAULT_LINES = 200;
const LOG_MAX_LINES = 5000;
/** Lines read from each service when filtering, to find enough matches. */
const LOG_SCAN_LINES = 5000;
export const MIN_TTL_SECONDS = 10 * 60;
/** Deploys of uploaded code a person may have waiting to start. */
export const MAX_WAITING_UPLOADS = 5;

export interface DeployRequest {
  primary: SourceRequest;
  sources: Record<string, SourceRequest>;
  fresh?: boolean;
  reseed?: boolean;
  ttlSeconds?: number;
}

/** A line of a service's output, as the API returns it. */
export interface LogLine {
  service: string;
  stream: "stdout" | "stderr";
  time: string;
  text: string;
}

/** What to read from the services' output. */
export interface LogQuery {
  services: string[];
  tail: number;
  since?: Date;
  until?: Date;
  grep?: string;
  errors: boolean;
}

/**
 * Lines of several services merged in time order and filtered, plus the time
 * of the newest line read for each service (filtered out or not), from which
 * a follower goes on.
 */
interface LogSnapshot {
  lines: LogLine[];
  containers: { service: string; id: string }[];
  newest: Map<string, string>;
  filter: (line: { service: string; text: string }) => boolean;
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

/** Lines a cut error may reach back for its first line. */
const ERROR_HEAD_LOOKBACK = 200;

/**
 * Where the last lines of an error log start, moved back so that no error
 * is cut: a stack trace without its first line ("error: relation does not
 * exist") hides the cause.
 */
export function wholeErrorsStart(lines: { service: string; continuation: boolean }[], tail: number): number {
  let start = Math.max(0, lines.length - tail);
  const seen = new Set<string>();
  for (let i = start; i < lines.length; i++) {
    const { service, continuation } = lines[i];
    if (seen.has(service)) {
      continue;
    }
    seen.add(service);
    if (!continuation) {
      continue;
    }
    for (let j = i - 1; j >= 0 && i - j <= ERROR_HEAD_LOOKBACK; j--) {
      if (lines[j].service === service && !lines[j].continuation) {
        start = Math.min(start, j);
        break;
      }
    }
  }
  return start;
}

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
    private readonly collector: MetricsCollector,
    private readonly audit: AuditService,
    private readonly archives: LogArchiveService,
    private readonly timeline: TimelineService,
    private readonly usage: UsageService,
    private readonly activity: ActivityService,
  ) {}

  /**
   * Live environments, newest first, within the project a token is
   * restricted to; with deleted, those deleted in the last 7 days instead.
   */
  async list(actor: Actor, filter: { project?: string; mine?: boolean; deleted?: boolean }) {
    const environments = await this.prisma.environment.findMany({
      where: {
        deletedAt: filter.deleted ? { gte: new Date(Date.now() - DELETED_VISIBLE_MS) } : null,
        ...(filter.project ? { project: { slug: filter.project } } : {}),
        ...(actor.projectId ? { projectId: actor.projectId } : {}),
        ...(filter.mine ? { ownerId: actor.user?.id ?? -1 } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: INCLUDE,
    });
    return environments.map((environment) => this.present(environment));
  }

  /**
   * A live environment, or one deleted in the last 7 days.
   */
  async get(actor: Actor, id: string) {
    return this.present(await this.find(actor, id, { deleted: true }));
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
    await this.ensureUploadRoom(actor, input.request);
    await this.usage.ensureRoom(project.id, "create", actor);

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

    const job = await this.queue.enqueue(environment.id, "create", this.payload(input.request), actor.user?.id ?? null, describeActor(actor));
    await this.audit.record(actor, "env.create", { target: `${project.slug}/${environment.slug}`, details: this.auditSources(input.request) });
    return { environment: await this.get(actor, environment.id), job: this.presentJob(job) };
  }

  /**
   * Postpones the expiry of an environment: it now expires after ttl.
   */
  async extend(actor: Actor, id: string, ttl: unknown) {
    const seconds = this.ttlSeconds(ttl);
    if (seconds === undefined) {
      throw new BadRequestException('expected { ttl: "24h" }');
    }
    const environment = await this.find(actor, id);
    assertCanAct(actor, "envs:write", environment);
    this.ensureNotDeleting(environment);
    const expiresAt = new Date(Date.now() + seconds * 1000);
    await this.prisma.environment.update({ where: { id: environment.id }, data: { expiresAt } });
    this.activity.touch(environment.id);
    await this.audit.record(actor, "env.extend", { target: this.label(environment), details: { ttlSeconds: seconds } });
    await this.timeline.record(environment.id, "extended", `Expiry postponed to ${expiresAt.toISOString()} by ${describeActor(actor)}`, { details: { expiresAt } });
    return this.get(actor, environment.id);
  }

  /**
   * Checks a lifetime given as a duration ("24h") or a number of seconds.
   *
   * @returns The lifetime in seconds, or undefined when none was given
   */
  ttlSeconds(ttl: unknown): number | undefined {
    if (ttl === undefined || ttl === null || ttl === "") {
      return undefined;
    }
    const seconds = parseDuration(ttl);
    const max = this.config.envTtlMaxSeconds;
    if (seconds === null || seconds < MIN_TTL_SECONDS || seconds > max) {
      throw new BadRequestException(`ttl must be a duration between 10m and ${Math.floor(max / 3600)}h, such as "24h"`);
    }
    return Math.round(seconds);
  }

  async update(actor: Actor, id: string, request: DeployRequest) {
    this.validateRequest(request);
    const environment = await this.find(actor, id);
    assertCanAct(actor, "envs:write", environment);
    this.ensureNotDeleting(environment);
    await this.ensureUploadRoom(actor, request);
    this.activity.touch(environment.id);
    const job = await this.queue.enqueue(environment.id, "update", this.payload(request), actor.user?.id ?? null, describeActor(actor));
    await this.audit.record(actor, "env.update", { target: this.label(environment), details: { ...this.auditSources(request), fresh: request.fresh, reseed: request.reseed } });
    return { environment: await this.get(actor, environment.id), job: this.presentJob(job) };
  }

  /**
   * Queues a stop, start, sleep, wake-up or deletion. Starting or waking
   * needs the memory of a typical environment of the project; putting to
   * sleep an environment already asleep, or waking one already awake, does
   * nothing (job: null).
   */
  async enqueue(actor: Actor, id: string, type: Extract<JobType, "delete" | "stop" | "start" | "sleep" | "wake">) {
    const environment = await this.find(actor, id);
    assertCanAct(actor, "envs:write", environment);
    this.ensureNotDeleting(environment);
    const pending = environment.jobs[0] && ["queued", "running"].includes(environment.jobs[0].status) ? environment.jobs[0] : null;
    if (type === "wake" || type === "sleep") {
      const target = type === "wake" ? "ready" : "sleeping";
      const already = pending ? pending.type === type : type === "wake" ? ["ready", "degraded"].includes(environment.status) : environment.status === "sleeping";
      if (already) {
        return { environment: this.present(environment), job: pending ? this.presentJob(pending) : null };
      }
      const from = type === "wake" ? ["sleeping"] : ["ready", "degraded"];
      if (!pending && !from.includes(environment.status)) {
        throw new ConflictException(`${environment.slug} is ${environment.status}: only a ${from.join(" or ")} environment can become ${target}`);
      }
    }
    if (type === "wake" || type === "start") {
      await this.usage.ensureRoom(environment.projectId, "resume", actor);
      this.activity.touch(environment.id);
    }
    const job = await this.queue.enqueue(environment.id, type, null, actor.user?.id ?? null, describeActor(actor));
    await this.audit.record(actor, `env.${type}`, { target: this.label(environment) });
    return { environment: this.present(environment), job: this.presentJob(job) };
  }

  /**
   * Runs a command in a service with an argument array (no shell) and
   * returns its exit code and outputs. Members run commands in their own
   * environments only.
   */
  async exec(actor: Actor, id: string, body: { service?: unknown; argv?: unknown; timeoutSec?: unknown; stdin?: unknown }) {
    if (typeof body.service !== "string" || !Array.isArray(body.argv) || body.argv.length === 0 || !body.argv.every((item) => typeof item === "string")) {
      throw new BadRequestException("expected { service: string, argv: string[] }");
    }
    const stdin = this.stdin(body.stdin);
    const timeoutSec = typeof body.timeoutSec === "number" ? Math.min(Math.max(body.timeoutSec, 1), EXEC_MAX_SECONDS) : EXEC_DEFAULT_SECONDS;
    const environment = await this.find(actor, id);
    assertCanAct(actor, "envs:exec", environment);
    const container = await this.runningContainer(environment, body.service);
    this.activity.touch(environment.id);
    const command = (body.argv as string[]).join(" ");
    await this.audit.record(actor, "env.exec", {
      target: this.label(environment),
      details: {
        service: body.service,
        command: command.length > AUDITED_COMMAND_LENGTH ? `${command.slice(0, AUDITED_COMMAND_LENGTH)}...` : command,
        ...(stdin ? { stdinBytes: stdin.length } : {}),
      },
    });
    return this.docker.exec(container, body.argv as string[], { timeoutMs: timeoutSec * 1000, maxOutputBytes: EXEC_MAX_OUTPUT_BYTES, stdin });
  }

  /**
   * Decodes the standard input of a command, sent in base64.
   */
  private stdin(value: unknown): Buffer | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
      throw new BadRequestException("stdin must be base64");
    }
    const buffer = Buffer.from(value, "base64");
    if (buffer.length > EXEC_MAX_STDIN_BYTES) {
      throw new BadRequestException(`stdin is larger than ${EXEC_MAX_STDIN_BYTES / 1024 / 1024} MiB`);
    }
    return buffer;
  }

  /**
   * Reads the output of services, merged in time order: the last lines, or
   * the last that match the filters among the lines read.
   */
  async logLines(actor: Actor, id: string, query: LogQuery): Promise<{ lines: LogLine[] }> {
    const environment = await this.find(actor, id, { deleted: true });
    const snapshot = await this.logSnapshot(environment, query);
    if (!environment.deletedAt) {
      this.activity.touch(environment.id);
    }
    return { lines: snapshot.lines };
  }

  /**
   * Prepares to follow the output of services: reads the last lines first,
   * so that a refused request (unknown environment or service) fails before
   * anything is streamed.
   *
   * @returns A function that sends those lines, then each new line that
   *   passes the filters until every service stops; it returns a function
   *   that stops following
   */
  async followLogLines(
    actor: Actor,
    id: string,
    query: LogQuery,
  ): Promise<(send: (line: LogLine) => void, onEnd: () => void) => Promise<() => void>> {
    const startedAt = Math.floor(Date.now() / 1000) - 1;
    const environment = await this.find(actor, id, { deleted: true });
    const snapshot = await this.logSnapshot(environment, query);
    if (!environment.deletedAt) {
      this.activity.touch(environment.id);
    }
    return (send, onEnd) => this.follow(snapshot, startedAt, send, onEnd);
  }

  private async follow(snapshot: LogSnapshot, startedAt: number, send: (line: LogLine) => void, onEnd: () => void): Promise<() => void> {
    snapshot.lines.forEach(send);
    let running = snapshot.containers.length;
    if (running === 0) {
      onEnd();
      return () => undefined;
    }
    const stops = await Promise.all(
      snapshot.containers.map(({ service, id: containerId }) =>
        this.docker.followLogs(
          containerId,
          { since: startedAt },
          (lines) => {
            for (const line of lines) {
              if (line.time <= (snapshot.newest.get(service) ?? "")) {
                continue;
              }
              snapshot.newest.set(service, line.time);
              if (snapshot.filter({ service, text: line.text })) {
                send(this.presentLogLine(service, line));
              }
            }
          },
          () => {
            running--;
            if (running === 0) {
              onEnd();
            }
          },
        ),
      ),
    );
    return () => stops.forEach((stop) => stop());
  }

  /**
   * Reads the last lines of the services: from Docker, or from the archives
   * of a deleted environment.
   */
  private async logSnapshot(environment: EnvironmentWithRelations, query: LogQuery): Promise<LogSnapshot> {
    const filtering = query.errors || Boolean(query.grep);
    let containers: { service: string; id: string }[] = [];
    let read: { service: string; line: RawLogLine }[];
    if (environment.deletedAt) {
      const sinceTime = query.since?.toISOString() ?? "";
      const untilTime = query.until?.toISOString() ?? "~";
      read = this.archives
        .read(environment.id)
        .filter(({ service, line }) => (query.services.length === 0 || query.services.includes(service)) && line.time >= sinceTime && line.time <= untilTime);
    } else {
      containers = await this.serviceContainers(environment, query.services);
      const since = query.since ? Math.floor(query.since.getTime() / 1000) : undefined;
      const until = query.until ? Math.ceil(query.until.getTime() / 1000) : undefined;
      read = (
        await Promise.all(
          containers.map(async ({ service, id }) =>
            (await this.docker.logLines(id, { tail: filtering ? LOG_SCAN_LINES : query.tail, since, until })).map((line) => ({ service, line })),
          ),
        )
      ).flat();
    }

    const newest = new Map<string, string>();
    const merged = read.sort((a, b) => (a.line.time < b.line.time ? -1 : a.line.time > b.line.time ? 1 : 0));
    merged.forEach(({ service, line }) => newest.set(service, line.time));

    const errors = new ErrorLineFilter();
    const filter = (line: { service: string; text: string }) => (!query.errors || errors.accept(line)) && (!query.grep || matchesGrep(line.text, query.grep));
    const kept: { service: string; line: RawLogLine; continuation: boolean }[] = [];
    for (const { service, line } of merged) {
      const kind = query.errors ? errors.classify({ service, text: line.text }) : "line";
      if (kind !== null && (!query.grep || matchesGrep(line.text, query.grep))) {
        kept.push({ service, line, continuation: kind === "continuation" });
      }
    }
    const start = query.errors && !query.grep ? wholeErrorsStart(kept, query.tail) : Math.max(0, kept.length - query.tail);
    return { lines: kept.slice(start).map(({ service, line }) => this.presentLogLine(service, line)), containers, newest, filter };
  }

  /**
   * Containers of the named services, or of every service of the environment.
   */
  private async serviceContainers(environment: Environment, services: string[]): Promise<{ service: string; id: string }[]> {
    const all = (await this.docker.listEnvironmentContainers(environment.id)).map((container) => ({
      service: container.Labels["com.docker.compose.service"],
      id: container.Id,
    }));
    if (services.length === 0) {
      return all;
    }
    const missing = services.filter((service) => !all.some((container) => container.service === service));
    if (missing.length > 0) {
      const known = all.map((container) => container.service).sort();
      throw new NotFoundException(`no container for ${missing.join(", ")}${known.length ? ` (services: ${known.join(", ")})` : ""}`);
    }
    return all.filter((container) => services.includes(container.service));
  }

  private presentLogLine(service: string, line: RawLogLine): LogLine {
    return { service, stream: line.stream, time: line.time.length > 24 ? `${line.time.slice(0, 23)}Z` : line.time, text: line.text };
  }

  /**
   * Parses the query of the logs route.
   */
  logQuery(raw: { service?: string; tail?: string; since?: string; until?: string; grep?: string; errors?: string }): LogQuery {
    const tail = raw.tail === undefined ? LOG_DEFAULT_LINES : Number(raw.tail);
    if (!Number.isInteger(tail) || tail < 1) {
      throw new BadRequestException("tail must be a positive whole number");
    }
    const date = (value: string | undefined, name: string) => {
      if (!value) {
        return undefined;
      }
      const parsed = /^\d+(\.\d+)?$/.test(value) ? new Date(Number(value) * 1000) : new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException(`${name} must be a date (ISO 8601) or a UNIX time`);
      }
      return parsed;
    };
    const since = date(raw.since, "since");
    const until = date(raw.until, "until");
    if (raw.grep !== undefined && raw.grep.length > 200) {
      throw new BadRequestException("grep is limited to 200 characters");
    }
    return {
      services: (raw.service ?? "").split(",").map((service) => service.trim()).filter(Boolean),
      tail: Math.min(tail, LOG_MAX_LINES),
      since,
      until,
      grep: raw.grep || undefined,
      errors: raw.errors === "true",
    };
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
   * The environment's containers, one per compose service, with their state,
   * health, restarts and out-of-memory kills. With usage, also their CPU,
   * memory and writable layer right now (about a second longer).
   */
  async services(actor: Actor, id: string, usage = false) {
    const environment = await this.find(actor, id, { deleted: true });
    const containers = await this.docker.listEnvironmentContainers(environment.id);
    const services = await Promise.all(containers.map((container) => this.describeService(container, usage)));
    return services.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async describeService(container: Docker.ContainerInfo, usage: boolean) {
    const info = await this.docker.client
      .getContainer(container.Id)
      .inspect({ size: usage } as Docker.ContainerInspectOptions)
      .catch(() => null);
    const running = container.State === "running";
    const service = {
      name: container.Labels["com.docker.compose.service"],
      state: container.State,
      status: container.Status,
      health: info?.State.Health?.Status ?? null,
      restartCount: info?.RestartCount ?? 0,
      oomKilled: info?.State.OOMKilled === true,
      exitCode: running ? null : (info?.State.ExitCode ?? null),
      startedAt: info?.State.StartedAt && !info.State.StartedAt.startsWith("0001") ? info.State.StartedAt : null,
    };
    if (!usage) {
      return service;
    }
    const live = running ? await this.docker.containerUsage(container.Id) : null;
    return {
      ...service,
      cpuPercent: live?.cpuPercent ?? null,
      memoryBytes: live?.memoryBytes ?? null,
      memoryLimitBytes: live?.memoryLimitBytes || info?.HostConfig.Memory || null,
      diskBytes: (info as { SizeRw?: number } | null)?.SizeRw ?? null,
    };
  }

  async jobs(actor: Actor, id: string) {
    const environment = await this.find(actor, id, { deleted: true });
    const jobs = await this.prisma.job.findMany({ where: { environmentId: environment.id }, orderBy: { createdAt: "desc" }, take: 10 });
    return jobs.map((job) => this.presentJob(job));
  }

  presentJob(job: Job) {
    return {
      id: job.id,
      environmentId: job.environmentId,
      type: job.type,
      status: job.status,
      phase: job.phase,
      error: job.error,
      errorCode: job.errorCode,
      actor: job.actor,
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

  /**
   * A live environment, or with deleted, one deleted in the last 7 days
   * (read-only: its page, timeline and archived logs stay).
   */
  private async find(actor: Actor, id: string, options: { deleted?: boolean } = {}): Promise<EnvironmentWithRelations> {
    const environment = await this.prisma.environment.findFirst({ where: options.deleted ? { id } : { id, deletedAt: null }, include: INCLUDE });
    if (!environment || (environment.deletedAt && environment.deletedAt.getTime() < Date.now() - DELETED_VISIBLE_MS)) {
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

  /**
   * Refuses a deploy of uploaded code from a person who already has 5
   * waiting to start: their archives stay on disk until their jobs run.
   *
   * @throws LimitReachedException with the code "quota"
   */
  private async ensureUploadRoom(actor: Actor, request: DeployRequest): Promise<void> {
    if (payloadArchives(request).length === 0) {
      return;
    }
    const queued = await this.prisma.job.findMany({
      where: { status: "queued", type: { in: ["create", "update"] }, triggeredById: actor.user?.id ?? null },
      select: { payload: true },
    });
    const waiting = queued.filter((job) => payloadArchives(job.payload as Partial<DeployPayload> | null).length > 0).length;
    if (waiting >= MAX_WAITING_UPLOADS) {
      throw new LimitReachedException(
        "quota",
        `You have ${waiting} deploys of uploaded code waiting to start, the most a person may have`,
        "wait for one of them to start (spawner status shows its job), then deploy again",
      );
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
    return {
      primary: request.primary,
      sources: request.sources,
      fresh: request.fresh === true,
      reseed: request.reseed === true,
      ...(request.ttlSeconds ? { ttlSeconds: request.ttlSeconds } : {}),
    };
  }

  /**
   * How long the environment stays awake without activity, and when it goes
   * to sleep if nothing happens before.
   */
  private sleep(environment: EnvironmentWithRelations): { idleSeconds: number; sleepsAt: Date | null } {
    const idleSeconds = idleSecondsOf(environment.manifest as Pick<Manifest, "idle"> | null, this.config.envIdleSeconds);
    const awake = ["ready", "degraded"].includes(environment.status) && !environment.deletedAt;
    const since = environment.lastActivityAt ?? environment.updatedAt;
    return { idleSeconds, sleepsAt: awake && idleSeconds > 0 ? new Date(since.getTime() + idleSeconds * 1000) : null };
  }

  private present(environment: EnvironmentWithRelations) {
    const urls = Object.fromEntries(environment.exposures.map((exposure) => [exposure.name, `${this.config.scheme}://${exposure.host}`]));
    const entrypoint = environment.exposures.find((exposure) => exposure.entrypoint);
    const primarySource = (environment.manifest as { name?: string } | null)?.name;
    const now = environment.deletedAt ? null : this.collector.environment(environment.id);
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
        onDisk: source.onDisk,
      })),
      lastJob: environment.jobs[0] ? this.presentJob(environment.jobs[0]) : null,
      expiresAt: environment.expiresAt,
      lastActivityAt: environment.lastActivityAt,
      ...this.sleep(environment),
      usage: now ? { cpuPercent: now.cpuPercent, memoryBytes: now.memoryBytes, memoryLimitBytes: now.memoryLimitBytes, at: now.at } : null,
      createdAt: environment.createdAt,
      updatedAt: environment.updatedAt,
      deletedAt: environment.deletedAt,
    };
  }
}
