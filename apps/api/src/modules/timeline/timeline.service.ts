import { Injectable, Logger } from "@nestjs/common";
import type { EnvironmentEvent, Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";

/**
 * Kinds of events of the timeline: what happened to the services (from
 * Docker), and to the environment (its jobs).
 */
export type EventType = "crash" | "oom" | "unhealthy" | "healthy" | "job_started" | "job_succeeded" | "job_failed" | "extended";

/** Crashes of one service in a short time: it restarts in a loop. */
export interface CrashLoop {
  service: string;
  /** Crashes and out-of-memory kills in the window. */
  count: number;
  windowMinutes: number;
  /** "out of memory (limit 512 MiB)" or "exit code 1". */
  lastCause: string;
  lastAt: Date;
}

const LOOP_WINDOW_MINUTES = 10;
const LOOP_THRESHOLD = 3;
const MAX_EVENTS = 200;

/**
 * The timeline of each environment: services that crash, run out of memory
 * or turn unhealthy, and the jobs that changed it. Recording never throws:
 * a lost event must not break what reported it.
 */
@Injectable()
export class TimelineService {
  private readonly logger = new Logger(TimelineService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(
    environmentId: string,
    type: EventType,
    message: string,
    options: { service?: string | null; details?: Record<string, unknown>; time?: Date } = {},
  ): Promise<void> {
    try {
      await this.prisma.environmentEvent.create({
        data: {
          environmentId,
          type,
          message: message.slice(0, 2000),
          service: options.service ?? null,
          details: (options.details ?? undefined) as Prisma.InputJsonValue | undefined,
          time: options.time ?? new Date(),
        },
      });
    } catch (error) {
      this.logger.warn(`Could not record a ${type} event of ${environmentId}: ${(error as Error).message}`);
    }
  }

  /**
   * Events of an environment, newest first.
   *
   * @param before - Id of the last event of the previous page
   */
  async list(environmentId: string, options: { limit?: number; before?: string } = {}) {
    const events = await this.prisma.environmentEvent.findMany({
      where: { environmentId, ...(options.before ? { id: { lt: BigInt(options.before) } } : {}) },
      orderBy: { id: "desc" },
      take: Math.min(Math.max(options.limit ?? 50, 1), MAX_EVENTS),
    });
    return events.map(presentEvent);
  }

  /**
   * Services that crashed or ran out of memory at least three times in the
   * last ten minutes: "api failed 3 times in 10 minutes, last cause: out
   * of memory (limit 512 MiB)".
   */
  async crashLoops(environmentIds: string[], now = new Date()): Promise<Map<string, CrashLoop[]>> {
    const since = new Date(now.getTime() - LOOP_WINDOW_MINUTES * 60_000);
    const events = environmentIds.length
      ? await this.prisma.environmentEvent.findMany({
          where: { environmentId: { in: environmentIds }, type: { in: ["crash", "oom"] }, time: { gte: since } },
          orderBy: { time: "asc" },
        })
      : [];
    return detectCrashLoops(events);
  }
}

/**
 * Groups crash and out-of-memory events by environment and service, and
 * keeps the services above the threshold. An out-of-memory kill is followed
 * by the container's exit (code 137), counted once.
 */
export function detectCrashLoops(events: Pick<EnvironmentEvent, "environmentId" | "service" | "type" | "time" | "details">[]): Map<string, CrashLoop[]> {
  const byService = new Map<string, typeof events>();
  for (const event of events) {
    const key = `${event.environmentId}\u0000${event.service ?? ""}`;
    byService.set(key, [...(byService.get(key) ?? []), event]);
  }
  const loops = new Map<string, CrashLoop[]>();
  for (const [key, serviceEvents] of byService) {
    const count = serviceEvents.filter((event, index) => !(event.type === "crash" && isOomExit(event, serviceEvents[index - 1]))).length;
    if (count < LOOP_THRESHOLD) {
      continue;
    }
    const [environmentId, service] = key.split("\u0000");
    const last = serviceEvents[serviceEvents.length - 1];
    const oom = last.type === "oom" || isOomExit(last, serviceEvents[serviceEvents.length - 2]);
    const details = (last.details ?? {}) as { exitCode?: number; limitBytes?: number };
    const lastOom = [...serviceEvents].reverse().find((event) => event.type === "oom");
    const limit = details.limitBytes ?? ((lastOom?.details ?? {}) as { limitBytes?: number }).limitBytes;
    loops.set(environmentId, [
      ...(loops.get(environmentId) ?? []),
      {
        service,
        count,
        windowMinutes: LOOP_WINDOW_MINUTES,
        lastCause: oom ? `out of memory${limit ? ` (limit ${Math.round(limit / 1024 ** 2)} MiB)` : ""}` : `exit code ${details.exitCode ?? "?"}`,
        lastAt: last.time,
      },
    ]);
  }
  return loops;
}

function isOomExit(event: { type: string; time: Date; details: unknown }, previous?: { type: string; time: Date }): boolean {
  return (
    event.type === "crash" &&
    (event.details as { exitCode?: number } | null)?.exitCode === 137 &&
    previous?.type === "oom" &&
    event.time.getTime() - previous.time.getTime() < 10_000
  );
}

export function presentEvent(event: EnvironmentEvent) {
  return {
    id: event.id.toString(),
    time: event.time,
    type: event.type,
    service: event.service,
    message: event.message,
    details: event.details,
  };
}
