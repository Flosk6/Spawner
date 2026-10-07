import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import * as fs from "fs";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../engine/storage.service";

const QUARTER_MS = 15 * 60_000;
const DAY_MS = 86_400_000;

/** How long each kind of record is kept. */
export const RETENTION = {
  metricPointsMs: 2 * DAY_MS,
  rollupsMs: 30 * DAY_MS,
  diskSnapshotsMs: 30 * DAY_MS,
  eventsMs: 30 * DAY_MS,
  terminalsMs: 30 * DAY_MS,
  deletedEnvironmentsMs: 7 * DAY_MS,
};

/**
 * Sums up the minutes into quarters of an hour (average and maximum), and
 * forgets what is past its retention: minutes after 48 hours, quarters,
 * disk measures, timeline events and terminal recordings after 30 days, and
 * deleted environments (with their archived logs and job logs) after 7 days.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Rolls up every finished quarter not rolled up yet.
   */
  @Cron("0 1,16,31,46 * * * *")
  async rollup(now = new Date()): Promise<number> {
    const [last] = await this.prisma.$queryRaw<{ time: Date | null }[]>`SELECT max(time) AS time FROM metric_rollups`;
    const [first] = await this.prisma.$queryRaw<{ time: Date | null }[]>`SELECT min(time) AS time FROM metric_points`;
    const from = last.time ? new Date(last.time.getTime() + QUARTER_MS) : first.time ? new Date(Math.floor(first.time.getTime() / QUARTER_MS) * QUARTER_MS) : null;
    const to = new Date(Math.floor(now.getTime() / QUARTER_MS) * QUARTER_MS);
    if (!from || from >= to) {
      return 0;
    }
    return this.prisma.$executeRaw`
      INSERT INTO metric_rollups (time, scope, environment_id, project_id, cpu_avg, cpu_max, memory_avg, memory_max)
      SELECT to_timestamp(floor(extract(epoch FROM time) / 900) * 900), scope, environment_id, project_id,
             avg(cpu_percent), max(cpu_percent), round(avg(memory_bytes))::bigint, max(memory_bytes)
      FROM metric_points
      WHERE time >= ${from} AND time < ${to}
      GROUP BY 1, scope, environment_id, project_id`;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purge(now = new Date()): Promise<void> {
    const before = (ms: number) => new Date(now.getTime() - ms);
    await this.prisma.metricPoint.deleteMany({ where: { time: { lt: before(RETENTION.metricPointsMs) } } });
    await this.prisma.metricRollup.deleteMany({ where: { time: { lt: before(RETENTION.rollupsMs) } } });
    await this.prisma.diskSnapshot.deleteMany({ where: { time: { lt: before(RETENTION.diskSnapshotsMs) } } });
    await this.prisma.environmentEvent.deleteMany({ where: { time: { lt: before(RETENTION.eventsMs) } } });

    const terminals = await this.prisma.terminalSession.findMany({ where: { startedAt: { lt: before(RETENTION.terminalsMs) } }, select: { id: true } });
    terminals.forEach((session) => fs.rmSync(this.storage.terminalRecordingPath(session.id), { force: true }));
    await this.prisma.terminalSession.deleteMany({ where: { id: { in: terminals.map((session) => session.id) } } });

    const deleted = await this.prisma.environment.findMany({
      where: { deletedAt: { lt: before(RETENTION.deletedEnvironmentsMs) } },
      select: { id: true, jobs: { select: { id: true } } },
    });
    for (const environment of deleted) {
      fs.rmSync(this.storage.archiveDir(environment.id), { recursive: true, force: true });
      environment.jobs.forEach((job) => fs.rmSync(this.storage.jobLogPath(job.id), { force: true }));
      await this.prisma.environment.delete({ where: { id: environment.id } }).catch((error) => this.logger.warn(`Could not purge ${environment.id}: ${(error as Error).message}`));
    }
    if (deleted.length > 0) {
      this.logger.log(`Purged ${deleted.length} environment(s) deleted more than 7 days ago`);
    }
  }
}
