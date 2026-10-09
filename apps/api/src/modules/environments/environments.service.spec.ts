import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it } from "vitest";
import { sessionActor, type Actor } from "../../common/actor";
import type { RawLogLine } from "../../common/docker-logs";
import type { DockerService } from "../../common/docker.service";
import type { PrismaService } from "../../common/prisma.service";
import type { SpawnerConfig } from "../../common/spawner.config";
import type { AuditService } from "../audit/audit.service";
import { LimitReachedException } from "../../common/limit-reached";
import type { JobQueueService } from "../engine/job-queue.service";
import type { LogArchiveService } from "../engine/log-archive.service";
import type { MetricsCollector } from "../supervision/metrics-collector.service";
import type { ActivityService } from "../lifecycle/activity.service";
import type { UsageService } from "../supervision/usage.service";
import type { TimelineService } from "../timeline/timeline.service";
import { EnvironmentsService, type LogLine } from "./environments.service";

const config = { scheme: "http", envTtlSeconds: 72 * 3600, envTtlMaxSeconds: 14 * 86400 } as SpawnerConfig;
const owner = sessionActor({ id: 1, name: "Ada", role: "member" });
const other = sessionActor({ id: 2, name: "Grace", role: "member" });

const t = (second: number) => `2026-10-07T10:00:${String(second).padStart(2, "0")}.000000000Z`;
const line = (second: number, text: string, stream: RawLogLine["stream"] = "stdout"): RawLogLine => ({ stream, time: t(second), text });

describe("EnvironmentsService", () => {
  let service: EnvironmentsService;
  let output: Record<string, RawLogLine[]>;
  let tailsAsked: number[];
  let followers: Record<string, { onLines: (lines: RawLogLine[]) => void; onEnd: () => void }>;
  let updates: { expiresAt?: Date }[];
  let archived: { service: string; line: RawLogLine }[];
  let deletedAt: Date | null;
  let queued: { triggeredById: number | null; payload: object }[];

  beforeEach(() => {
    output = {
      api: [line(1, "listening"), line(3, "Error: boom", "stderr"), line(4, "    at handler (server.js:1:1)", "stderr"), line(6, "GET / 200")],
      db: [line(2, "ready to accept connections"), line(5, 'ERROR:  relation "users" does not exist', "stderr")],
    };
    tailsAsked = [];
    followers = {};
    updates = [];
    archived = [];
    deletedAt = null;
    queued = [];
    const environment = {
      id: "env-1",
      slug: "feat-login",
      status: "ready",
      ownerId: 1,
      projectId: "p-1",
      project: { slug: "blog" },
      owner: null,
      sources: [],
      exposures: [],
      jobs: [],
      manifest: null,
      get deletedAt() {
        return deletedAt;
      },
    };
    const prisma = {
      environment: {
        findFirst: async ({ where }: { where: { deletedAt?: null } }) => (where.deletedAt === null && deletedAt ? null : environment),
        update: async ({ data }: { data: { expiresAt?: Date } }) => updates.push(data),
      },
      job: {
        findMany: async ({ where }: { where: { status: string; triggeredById: number | null } }) =>
          queued.filter((job) => where.status === "queued" && job.triggeredById === where.triggeredById),
      },
    };
    const docker = {
      listEnvironmentContainers: async () => Object.keys(output).map((service) => ({ Id: `c-${service}`, Labels: { "com.docker.compose.service": service } })),
      logLines: async (id: string, options: { tail: number }) => {
        tailsAsked.push(options.tail);
        return output[id.slice(2)].slice(-options.tail);
      },
      followLogs: async (id: string, _options: unknown, onLines: (lines: RawLogLine[]) => void, onEnd: () => void) => {
        followers[id.slice(2)] = { onLines, onEnd };
        return () => undefined;
      },
    };
    const audit = { record: async () => undefined };
    const timeline = { record: async () => undefined };
    service = new EnvironmentsService(
      prisma as unknown as PrismaService,
      {
        enqueue: async () => {
          throw new Error("queued");
        },
      } as unknown as JobQueueService,
      config,
      docker as unknown as DockerService,
      { environment: () => null } as unknown as MetricsCollector,
      audit as unknown as AuditService,
      { read: () => archived } as unknown as LogArchiveService,
      timeline as unknown as TimelineService,
      { ensureRoom: async () => undefined } as unknown as UsageService,
      { touch: () => undefined } as unknown as ActivityService,
    );
  });

  const query = (overrides: Partial<Parameters<EnvironmentsService["logQuery"]>[0]> = {}) => service.logQuery({ ...overrides });

  describe("logLines", () => {
    it("merges the services in time order and keeps the last lines", async () => {
      const { lines } = await service.logLines(owner, "env-1", query({ tail: "3" }));
      expect(lines.map((entry) => `${entry.service}: ${entry.text}`)).toEqual([
        "api:     at handler (server.js:1:1)",
        'db: ERROR:  relation "users" does not exist',
        "api: GET / 200",
      ]);
      expect(lines[0]).toEqual({ service: "api", stream: "stderr", time: "2026-10-07T10:00:04.000Z", text: "    at handler (server.js:1:1)" });
    });

    it("finds the errors, with their stack traces, among more lines", async () => {
      const { lines } = await service.logLines(owner, "env-1", query({ errors: "true", tail: "10" }));
      expect(lines.map((entry) => entry.text)).toEqual(["Error: boom", "    at handler (server.js:1:1)", 'ERROR:  relation "users" does not exist']);
      expect(tailsAsked).toEqual([5000, 5000]);
    });

    it("moves back to the first line of an error cut by the tail", async () => {
      output.api = [line(1, "Error: boom"), ...Array.from({ length: 30 }, (_, index) => line(2, `    at frame${index} (parseErrorMessage.js:1:1)`)), line(3, "GET / 200")];
      const { lines } = await service.logLines(owner, "env-1", query({ service: "api", errors: "true", tail: "5" }));
      expect(lines[0].text).toBe("Error: boom");
      expect(lines).toHaveLength(31);
    });

    it("searches a text in the services asked for", async () => {
      const { lines } = await service.logLines(owner, "env-1", query({ service: "db", grep: "READY" }));
      expect(lines.map((entry) => entry.text)).toEqual(["ready to accept connections"]);
    });

    it("reads the archived logs of a deleted environment", async () => {
      deletedAt = new Date();
      archived = [
        { service: "api", line: line(2, "Error: last words", "stderr") },
        { service: "db", line: line(1, "shutting down") },
      ];
      const { lines } = await service.logLines(owner, "env-1", query({ errors: "true" }));
      expect(lines.map((entry) => entry.text)).toEqual(["Error: last words"]);
      await expect(service.extend(owner, "env-1", "1h")).rejects.toThrow(NotFoundException);
    });

    it("names the services when one is unknown", async () => {
      await expect(service.logLines(owner, "env-1", query({ service: "web" }))).rejects.toThrow(new NotFoundException("no container for web (services: api, db)"));
    });
  });

  describe("followLogLines", () => {
    it("sends the last lines, then the new lines that pass the filters, until every service stops", async () => {
      const sent: LogLine[] = [];
      let ended = false;
      const start = await service.followLogLines(owner, "env-1", query({ errors: "true" }));
      await start(
        (entry) => sent.push(entry),
        () => (ended = true),
      );
      expect(sent).toHaveLength(3);

      followers.api.onLines([line(6, "GET / 200"), line(7, "TypeError: x is undefined", "stderr"), line(8, "GET /health 200")]);
      followers.db.onLines([line(5, 'ERROR:  relation "users" does not exist', "stderr")]);
      expect(sent.slice(3).map((entry) => entry.text)).toEqual(["TypeError: x is undefined"]);

      followers.api.onEnd();
      expect(ended).toBe(false);
      followers.db.onEnd();
      expect(ended).toBe(true);
    });
  });

  describe("logQuery", () => {
    it("reads the filters of the route", () => {
      expect(service.logQuery({ service: "api, db", tail: "50", since: "2026-10-07T10:00:00Z", grep: "users", errors: "true" })).toEqual({
        services: ["api", "db"],
        tail: 50,
        since: new Date("2026-10-07T10:00:00Z"),
        grep: "users",
        errors: true,
      });
      expect(service.logQuery({ tail: "100000" }).tail).toBe(5000);
      expect(service.logQuery({ since: "1791367200" }).since).toEqual(new Date(1791367200 * 1000));
    });

    it.each([{ tail: "0" }, { tail: "ten" }, { since: "yesterday" }, { grep: "x".repeat(201) }])("refuses %j", (raw) => {
      expect(() => service.logQuery(raw)).toThrow(BadRequestException);
    });
  });

  describe("lifetimes", () => {
    it("accepts durations between ten minutes and the maximum", () => {
      expect(service.ttlSeconds(undefined)).toBeUndefined();
      expect(service.ttlSeconds("24h")).toBe(86400);
      expect(service.ttlSeconds(3600)).toBe(3600);
      for (const ttl of ["5m", "15d", "soon"]) {
        expect(() => service.ttlSeconds(ttl)).toThrow(BadRequestException);
      }
    });

    it("lets the owner extend an environment, not another member", async () => {
      await expect(service.extend(other as Actor, "env-1", "24h")).rejects.toThrow(ForbiddenException);
      const before = Date.now();
      await service.extend(owner, "env-1", "24h");
      expect(updates).toHaveLength(1);
      expect(updates[0].expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 86400_000);
    });
  });

  describe("update", () => {
    const upload = { primary: { origin: "upload" as const, archive: "/data/uploads/new.tar.gz" }, sources: {} };
    const git = { primary: { origin: "git" as const, ref: "main" }, sources: {} };

    it("refuses a sixth deploy of uploaded code waiting to start, from the same person only", async () => {
      queued = Array.from({ length: 4 }, () => ({ triggeredById: 1, payload: { primary: { origin: "upload", archive: "/data/uploads/a.tar.gz" }, sources: {} } }));
      queued.push({ triggeredById: 1, payload: { primary: { origin: "git" }, sources: { front: { origin: "upload", archive: "/data/uploads/b.tar.gz" } } } });
      queued.push({ triggeredById: 1, payload: git }, { triggeredById: 2, payload: upload });

      await expect(service.update(owner, "env-1", upload)).rejects.toBeInstanceOf(LimitReachedException);
      await expect(service.update(owner, "env-1", upload)).rejects.toThrow("You have 5 deploys of uploaded code waiting to start");
      await expect(service.update(owner, "env-1", git)).rejects.toThrow("queued");
      queued.pop();
      queued.shift();
      await expect(service.update(owner, "env-1", upload)).rejects.toThrow("queued");
    });
  });
});
