import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { composeProjectName } from "@spawner/core";
import * as fs from "fs";
import { directorySize } from "../../common/directory-size";
import { DockerService } from "../../common/docker.service";
import { PrismaService } from "../../common/prisma.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { StorageService } from "../engine/storage.service";
import { attributeDisk, type DiskBreakdown, type DockerDiskUsage } from "./disk";

const MEASURE_EVERY_MS = 15 * 60_000;
const CHECK_JOBS_EVERY_MS = 60_000;

export interface DiskSnapshotView {
  time: Date;
  totalBytes: number;
  freeBytes: number;
  details: DiskBreakdown;
}

/**
 * Measures the disk: `docker system df` (images, build cache, volumes,
 * writable layers), the sources of the environments and Spawner's logs.
 * Computing volume sizes is costly: every 15 minutes, and within a minute
 * after a build or a deletion.
 */
@Injectable()
export class DiskService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DiskService.name);
  private latestSnapshot: DiskSnapshotView | null = null;
  private measuring: Promise<DiskSnapshotView | null> | null = null;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly docker: DockerService,
    private readonly prisma: PrismaService,
    private readonly config: SpawnerConfig,
    private readonly storage: StorageService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === "test") {
      return;
    }
    this.timers.push(setInterval(() => void this.measure(), MEASURE_EVERY_MS), setInterval(() => void this.measureAfterJobs(), CHECK_JOBS_EVERY_MS));
    setTimeout(() => void this.measure(), 60_000).unref();
  }

  onModuleDestroy(): void {
    this.timers.forEach((timer) => clearInterval(timer));
  }

  /**
   * The last measure, from memory or the database.
   */
  async latest(): Promise<DiskSnapshotView | null> {
    if (this.latestSnapshot) {
      return this.latestSnapshot;
    }
    const row = await this.prisma.diskSnapshot.findFirst({ orderBy: { time: "desc" } });
    this.latestSnapshot = row ? present(row) : null;
    return this.latestSnapshot;
  }

  /**
   * Measures now; a measure already running is shared.
   */
  measure(): Promise<DiskSnapshotView | null> {
    this.measuring ??= this.take()
      .catch((error) => {
        this.logger.warn(`Disk measure failed: ${(error as Error).message}`);
        return null;
      })
      .finally(() => (this.measuring = null));
    return this.measuring;
  }

  private async measureAfterJobs(): Promise<void> {
    const last = await this.latest();
    const changed = await this.prisma.job.count({
      where: { type: { in: ["create", "update", "delete"] }, finishedAt: { gt: last?.time ?? new Date(0) } },
    });
    if (changed > 0) {
      await this.measure();
    }
  }

  private async take(): Promise<DiskSnapshotView> {
    const [usage, environments, ownProject, logsBytes] = await Promise.all([
      this.docker.client.df() as Promise<DockerDiskUsage>,
      this.prisma.environment.findMany({
        where: { deletedAt: null },
        include: { project: { select: { slug: true } }, sources: { where: { onDisk: true }, select: { sizeBytes: true } } },
      }),
      this.docker.ownComposeProject(),
      Promise.all([this.storage.jobsDir, this.storage.archivesDir, this.storage.terminalsDir].map(directorySize)).then((sizes) => sizes.reduce((sum, size) => sum + size, 0)),
    ]);
    const details = attributeDisk(usage, {
      environmentsByProject: new Map(environments.map((environment) => [composeProjectName(environment.project.slug, environment.slug), environment.id])),
      sources: new Map(environments.map((environment) => [environment.id, environment.sources.reduce((sum, source) => sum + Number(source.sizeBytes ?? 0), 0)])),
      ownProject,
      logsBytes,
    });
    const filesystem = fs.statfsSync(this.config.dataDir);
    const row = await this.prisma.diskSnapshot.create({
      data: {
        totalBytes: BigInt(filesystem.blocks * filesystem.bsize),
        freeBytes: BigInt(filesystem.bavail * filesystem.bsize),
        details: details as unknown as Prisma.InputJsonValue,
      },
    });
    this.latestSnapshot = present(row);
    return this.latestSnapshot;
  }
}

function present(row: { time: Date; totalBytes: bigint; freeBytes: bigint; details: Prisma.JsonValue }): DiskSnapshotView {
  return { time: row.time, totalBytes: Number(row.totalBytes), freeBytes: Number(row.freeBytes), details: row.details as unknown as DiskBreakdown };
}
