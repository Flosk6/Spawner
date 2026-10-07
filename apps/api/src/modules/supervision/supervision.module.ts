import { Controller, Get, Module, NotFoundException, Param, Query } from "@nestjs/common";
import { assertInProject, type Actor } from "../../common/actor";
import { CurrentActor, Scopes } from "../../common/auth.guard";
import { PrismaService } from "../../common/prisma.service";
import { EngineModule } from "../engine/engine.module";
import { TimelineService } from "../timeline/timeline.service";
import { DiskService } from "./disk.service";
import { DockerEventsService } from "./docker-events.service";
import { MetricsCollector } from "./metrics-collector.service";
import { RetentionService } from "./retention.service";
import { parseRange, UsageService } from "./usage.service";

/**
 * What happened to an environment and what it uses: its timeline, its
 * resources over time and its disk. Deleted environments stay readable 7
 * days.
 */
@Controller("v1/envs/:id")
@Scopes("envs:read")
export class EnvironmentSupervisionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly timeline: TimelineService,
    private readonly disk: DiskService,
  ) {}

  /**
   * Timeline, newest first: { events, crashLoops }.
   */
  @Get("events")
  async events(@CurrentActor() actor: Actor, @Param("id") id: string, @Query("limit") limit?: string, @Query("before") before?: string) {
    await this.environment(actor, id);
    const [events, loops] = await Promise.all([
      this.timeline.list(id, { limit: limit ? Number(limit) || 50 : 50, before: before && /^\d+$/.test(before) ? before : undefined }),
      this.timeline.crashLoops([id]),
    ]);
    return { events, crashLoops: loops.get(id) ?? [] };
  }

  /**
   * CPU and memory over a range (1h, 6h, 24h, 7d), with each service.
   */
  @Get("metrics")
  async metrics(@CurrentActor() actor: Actor, @Param("id") id: string, @Query("range") range?: string) {
    await this.environment(actor, id);
    return this.usage.environmentMetrics(id, parseRange(range, "24h"));
  }

  /**
   * What the environment holds on disk, at the last measure.
   */
  @Get("disk")
  async diskUsage(@CurrentActor() actor: Actor, @Param("id") id: string) {
    await this.environment(actor, id);
    const snapshot = await this.disk.latest();
    return { measuredAt: snapshot?.time ?? null, disk: snapshot?.details.environments[id] ?? null };
  }

  private async environment(actor: Actor, id: string) {
    const environment = await this.prisma.environment.findUnique({ where: { id }, select: { projectId: true } });
    if (!environment) {
      throw new NotFoundException(`environment "${id}" not found`);
    }
    assertInProject(actor, environment.projectId);
  }
}

/**
 * The host: usage now and over time, alerts, and room for more
 * environments.
 */
@Controller("v1/system")
export class SystemController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  @Scopes("admin")
  system() {
    return this.usage.system();
  }

  @Get("metrics")
  @Scopes("admin")
  metrics(@Query("range") range?: string) {
    return this.usage.systemMetrics(parseRange(range, "24h"));
  }

  /**
   * How many more environments of each project fit: read by everyone, the
   * CLI included (spawner capacity).
   */
  @Get("capacity")
  @Scopes("envs:read")
  capacity() {
    return this.usage.capacity();
  }
}

@Controller("v1/projects/:slug")
@Scopes("envs:read")
export class ProjectUsageController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
  ) {}

  /**
   * What the project uses now, and what one of its environments typically
   * costs: memory, disk, build time.
   */
  @Get("usage")
  async projectUsage(@CurrentActor() actor: Actor, @Param("slug") slug: string) {
    const project = await this.prisma.project.findUnique({ where: { slug } });
    if (!project) {
      throw new NotFoundException(`project "${slug}" not found`);
    }
    assertInProject(actor, project.id);
    return this.usage.projectUsage(project.id);
  }
}

@Module({
  imports: [EngineModule],
  controllers: [EnvironmentSupervisionController, SystemController, ProjectUsageController],
  providers: [MetricsCollector, DiskService, DockerEventsService, UsageService, RetentionService],
  exports: [MetricsCollector, DiskService],
})
export class SupervisionModule {}
