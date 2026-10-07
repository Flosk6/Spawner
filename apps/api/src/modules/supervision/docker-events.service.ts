import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { DockerService } from "../../common/docker.service";
import { PrismaService } from "../../common/prisma.service";
import { TimelineService, type EventType } from "../timeline/timeline.service";

/** A container event of the Docker events API. */
export interface DockerEvent {
  Type: string;
  Action: string;
  Actor: { ID: string; Attributes: Record<string, string> };
  time: number;
  timeNano?: number;
}

/** What the timeline needs to know besides the event itself. */
export interface EventContext {
  /** A job (deploy, stop, delete) works on the environment: its containers stop on purpose. */
  jobRunning: boolean;
  /** The container was killed for lack of memory just before this exit. */
  afterOom: boolean;
  /** The container was reported unhealthy before. */
  wasUnhealthy: boolean;
  memoryLimitBytes?: number;
  /** Output of the last failed healthcheck. */
  healthOutput?: string;
}

/** Exit codes of containers stopped on purpose: normal end, SIGKILL, SIGTERM. */
const STOP_CODES = new Set([0, 137, 143]);

/**
 * Turns a Docker event into a timeline event, or null when it says nothing
 * worth showing (a container stopped by a job, a healthy service).
 */
export function interpretDockerEvent(event: DockerEvent, context: EventContext): { type: EventType; message: string; details: Record<string, unknown> } | null {
  const service = event.Actor.Attributes["com.docker.compose.service"] ?? event.Actor.Attributes.name ?? "a service";
  if (event.Action === "oom") {
    const limit = context.memoryLimitBytes ? ` (limit ${Math.round(context.memoryLimitBytes / 1024 ** 2)} MiB)` : "";
    return { type: "oom", message: `${service} ran out of memory${limit}`, details: { limitBytes: context.memoryLimitBytes ?? null } };
  }
  if (event.Action === "die") {
    const exitCode = Number(event.Actor.Attributes.exitCode ?? -1);
    if ((context.afterOom && exitCode === 137) || (context.jobRunning && STOP_CODES.has(exitCode))) {
      return null;
    }
    const how =
      exitCode === 0 ? "stopped (exit code 0)" : exitCode === 137 ? "was killed (SIGKILL, exit code 137)" : exitCode === 143 ? "was stopped (SIGTERM, exit code 143)" : `crashed (exit code ${exitCode})`;
    return { type: "crash", message: `${service} ${how}`, details: { exitCode } };
  }
  if (event.Action.startsWith("health_status")) {
    const status = event.Action.split(":")[1]?.trim();
    if (status === "unhealthy") {
      return { type: "unhealthy", message: `${service} is unhealthy${context.healthOutput ? `: ${context.healthOutput}` : ""}`, details: { output: context.healthOutput ?? null } };
    }
    if (status === "healthy" && context.wasUnhealthy) {
      return { type: "healthy", message: `${service} is healthy again`, details: {} };
    }
  }
  return null;
}

const RECONNECT_MAX_MS = 30_000;
const OOM_EXIT_WINDOW_MS = 10_000;

/**
 * Follows the Docker events of the environments' containers (one stream,
 * filtered on the dev.spawner.env label) and records in their timeline the
 * services that crash, run out of memory or turn unhealthy. The stream
 * reconnects after a Docker restart, replaying what it missed.
 */
@Injectable()
export class DockerEventsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DockerEventsService.name);
  private readonly lastOom = new Map<string, number>();
  private readonly unhealthy = new Set<string>();
  private readonly recent: string[] = [];
  private stream: NodeJS.ReadableStream | null = null;
  private since = Math.floor(Date.now() / 1000);
  private retryMs = 1000;
  private stopped = false;

  constructor(
    private readonly docker: DockerService,
    private readonly prisma: PrismaService,
    private readonly timeline: TimelineService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV !== "test") {
      void this.connect();
    }
  }

  onModuleDestroy(): void {
    this.stopped = true;
    (this.stream as unknown as { destroy?: () => void } | null)?.destroy?.();
  }

  private async connect(): Promise<void> {
    if (this.stopped) {
      return;
    }
    try {
      const stream = (await this.docker.client.getEvents({
        since: this.since,
        filters: { type: ["container"], label: ["dev.spawner.env"], event: ["die", "oom", "health_status"] },
      })) as NodeJS.ReadableStream;
      this.stream = stream;
      this.retryMs = 1000;
      let buffer = "";
      stream.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter((candidate) => candidate.trim())) {
          try {
            void this.handle(JSON.parse(line) as DockerEvent);
          } catch {
            continue;
          }
        }
      });
      const retry = () => {
        if (this.stream === stream) {
          this.stream = null;
          this.reconnectLater();
        }
      };
      stream.on("end", retry);
      stream.on("error", retry);
    } catch (error) {
      this.logger.warn(`Cannot follow Docker events: ${(error as Error).message}`);
      this.reconnectLater();
    }
  }

  private reconnectLater(): void {
    if (this.stopped) {
      return;
    }
    setTimeout(() => void this.connect(), this.retryMs).unref();
    this.retryMs = Math.min(this.retryMs * 2, RECONNECT_MAX_MS);
  }

  /**
   * Records an event in the timeline of its environment.
   */
  async handle(event: DockerEvent): Promise<void> {
    const key = `${event.Actor.ID}:${event.Action}:${event.timeNano ?? event.time}`;
    if (this.recent.includes(key)) {
      return;
    }
    this.recent.push(key);
    if (this.recent.length > 200) {
      this.recent.shift();
    }
    this.since = Math.max(this.since, event.time);

    const environmentId = event.Actor.Attributes["dev.spawner.env"];
    const containerId = event.Actor.ID;
    const time = new Date(event.timeNano ? event.timeNano / 1e6 : event.time * 1000);
    if (!environmentId || !(await this.prisma.environment.findUnique({ where: { id: environmentId }, select: { id: true } }))) {
      return;
    }

    const context: EventContext = {
      jobRunning: (await this.prisma.job.count({ where: { environmentId, status: "running" } })) > 0,
      afterOom: time.getTime() - (this.lastOom.get(containerId) ?? 0) < OOM_EXIT_WINDOW_MS,
      wasUnhealthy: this.unhealthy.has(containerId),
    };
    if (event.Action === "oom" || event.Action.includes("unhealthy")) {
      const info = await this.docker.client
        .getContainer(containerId)
        .inspect()
        .catch(() => null);
      context.memoryLimitBytes = info?.HostConfig.Memory || undefined;
      const lastCheck = info?.State.Health?.Log?.[info.State.Health.Log.length - 1];
      context.healthOutput = lastCheck?.Output?.trim().slice(-300) || undefined;
    }
    if (event.Action === "oom") {
      this.lastOom.set(containerId, time.getTime());
    }
    if (event.Action.includes("unhealthy")) {
      this.unhealthy.add(containerId);
    } else if (event.Action.includes("healthy")) {
      this.unhealthy.delete(containerId);
    }

    const entry = interpretDockerEvent(event, context);
    if (entry) {
      await this.timeline.record(environmentId, entry.type, entry.message, {
        service: event.Actor.Attributes["com.docker.compose.service"] ?? null,
        details: entry.details,
        time,
      });
    }
  }
}
