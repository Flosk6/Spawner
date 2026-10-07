import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import type { PrismaService } from "../../common/prisma.service";
import type { StorageService } from "../engine/storage.service";
import { RetentionService } from "./retention.service";

describe("RetentionService", () => {
  it("purges deleted environments after 7 days, with their archives and job logs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "retention-"));
    const storage = {
      archiveDir: (id: string) => path.join(root, "archives", id),
      jobLogPath: (id: string) => path.join(root, "jobs", `${id}.log`),
      terminalRecordingPath: (id: string) => path.join(root, "terminals", `${id}.log`),
    } as StorageService;
    fs.mkdirSync(storage.archiveDir("old"), { recursive: true });
    fs.mkdirSync(path.join(root, "jobs"));
    fs.mkdirSync(path.join(root, "terminals"));
    fs.writeFileSync(storage.jobLogPath("j1"), "log");
    fs.writeFileSync(storage.terminalRecordingPath("t1"), "recording");
    const deletes: string[] = [];
    const where: Record<string, unknown> = {};
    const deleting = (table: string) => ({
      deleteMany: async (query: { where: unknown }) => {
        where[table] = query.where;
        deletes.push(table);
      },
    });
    const prisma = {
      metricPoint: deleting("metricPoint"),
      metricRollup: deleting("metricRollup"),
      diskSnapshot: deleting("diskSnapshot"),
      environmentEvent: deleting("environmentEvent"),
      terminalSession: { findMany: async () => [{ id: "t1" }], ...deleting("terminalSession") },
      environment: {
        findMany: async () => [{ id: "old", jobs: [{ id: "j1" }] }],
        delete: async ({ where: { id } }: { where: { id: string } }) => deletes.push(`environment:${id}`),
      },
    } as unknown as PrismaService;

    const now = new Date("2026-10-08T12:00:00Z");
    await new RetentionService(prisma, storage).purge(now);
    expect(deletes).toEqual(["metricPoint", "metricRollup", "diskSnapshot", "environmentEvent", "terminalSession", "environment:old"]);
    expect(where.metricPoint).toEqual({ time: { lt: new Date("2026-10-06T12:00:00Z") } });
    expect(fs.existsSync(storage.archiveDir("old"))).toBe(false);
    expect(fs.existsSync(storage.jobLogPath("j1"))).toBe(false);
    expect(fs.existsSync(storage.terminalRecordingPath("t1"))).toBe(false);
  });

  it("rolls up the quarters not rolled up yet", async () => {
    const queries: unknown[][] = [];
    const prisma = {
      $queryRaw: async (strings: TemplateStringsArray) =>
        strings.join("").includes("metric_rollups") ? [{ time: new Date("2026-10-08T11:00:00Z") }] : [{ time: new Date("2026-10-08T09:03:00Z") }],
      $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        queries.push(values);
        return 4;
      },
    } as unknown as PrismaService;
    const service = new RetentionService(prisma, {} as StorageService);
    expect(await service.rollup(new Date("2026-10-08T11:47:00Z"))).toBe(4);
    expect(queries).toEqual([[new Date("2026-10-08T11:15:00Z"), new Date("2026-10-08T11:45:00Z")]]);
    expect(await service.rollup(new Date("2026-10-08T11:20:00Z"))).toBe(0);
  });
});
