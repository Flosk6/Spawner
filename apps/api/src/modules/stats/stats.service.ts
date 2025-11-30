import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../common/prisma.service";
import { DockerService } from "../../common/docker.service";

@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  constructor(
    private prisma: PrismaService,
    private dockerService: DockerService
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async collectEnvironmentStats() {
    this.logger.debug("Starting stats collection...");

    try {
      const runningEnvironments = await this.prisma.environment.findMany({
        where: { status: "running" },
        select: {
          id: true,
          name: true,
        },
      });

      this.logger.debug(
        `Found ${runningEnvironments.length} running environments`
      );

      for (const environment of runningEnvironments) {
        try {
          const stats = await this.dockerService.getEnvironmentStats(
            environment.name
          );

          const totalMemoryUsageGB =
            stats.totalMemoryUsage / (1024 * 1024 * 1024);
          const totalMemoryLimitGB =
            stats.totalMemoryLimit / (1024 * 1024 * 1024);

          await this.prisma.$executeRaw`
            INSERT INTO "EnvironmentStats" (
              "time",
              "environmentId",
              "cpuPercent",
              "memoryUsageGB",
              "memoryLimitGB",
              "containers"
            ) VALUES (
              NOW(),
              ${environment.id},
              ${stats.totalCpu},
              ${Math.round(totalMemoryUsageGB * 10) / 10},
              ${Math.round(totalMemoryLimitGB * 10) / 10},
              ${JSON.stringify(
                stats.containers.map((c) => ({
                  name: c.name,
                  cpuPercent: c.cpuPercent,
                  memoryUsageGB:
                    Math.round((c.memoryUsage / (1024 * 1024 * 1024)) * 10) /
                    10,
                  memoryLimitGB:
                    Math.round((c.memoryLimit / (1024 * 1024 * 1024)) * 10) /
                    10,
                }))
              )}::jsonb
            )
          `;

          this.logger.debug(
            `Collected stats for environment ${environment.name}`
          );
        } catch (error) {
          this.logger.error(
            `Failed to collect stats for environment ${environment.name}: ${error.message}`
          );
        }
      }

      this.logger.debug("Stats collection completed");
    } catch (error) {
      this.logger.error(`Stats collection failed: ${error.message}`);
    }
  }

  async getLatestStats(environmentId: string) {
    const result = await this.prisma.$queryRaw<
      Array<{
        time: Date;
        environmentId: string;
        cpuPercent: number;
        memoryUsageGB: number;
        memoryLimitGB: number;
        containers: any;
      }>
    >`
      SELECT
        "time",
        "environmentId",
        "cpuPercent",
        "memoryUsageGB",
        "memoryLimitGB",
        "containers"
      FROM "EnvironmentStats"
      WHERE "environmentId" = ${environmentId}
      ORDER BY "time" DESC
      LIMIT 1
    `;

    return result.length > 0 ? result[0] : null;
  }

  async getStatsHistory(
    environmentId: string,
    fromTime?: Date,
    toTime?: Date
  ) {
    const from = fromTime || new Date(Date.now() - 3600000); // Default: last hour
    const to = toTime || new Date();

    return this.prisma.$queryRaw<
      Array<{
        time: Date;
        cpuPercent: number;
        memoryUsageGB: number;
        memoryLimitGB: number;
      }>
    >`
      SELECT
        "time",
        "cpuPercent",
        "memoryUsageGB",
        "memoryLimitGB"
      FROM "EnvironmentStats"
      WHERE "environmentId" = ${environmentId}
        AND "time" >= ${from}
        AND "time" <= ${to}
      ORDER BY "time" ASC
    `;
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupOldStats() {
    this.logger.debug("Starting stats cleanup...");

    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const result = await this.prisma.$executeRaw`
        DELETE FROM "EnvironmentStats"
        WHERE "time" < ${thirtyDaysAgo}
      `;

      this.logger.log(`Deleted ${result} old stats records`);
    } catch (error) {
      this.logger.error(`Stats cleanup failed: ${error.message}`);
    }
  }
}
