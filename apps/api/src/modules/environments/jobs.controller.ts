import { Controller, Get, Header, MessageEvent, NotFoundException, Param, Sse } from "@nestjs/common";
import { Observable, map } from "rxjs";
import { assertInProject, type Actor } from "../../common/actor";
import { CurrentActor, Scopes } from "../../common/auth.guard";
import { PrismaService } from "../../common/prisma.service";
import { JobLogsService } from "../engine/job-logs.service";
import { EnvironmentsService } from "./environments.service";

const FINISHED = ["succeeded", "failed", "cancelled"];

@Controller("v1/jobs")
@Scopes("envs:read")
export class JobsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logs: JobLogsService,
    private readonly environments: EnvironmentsService,
  ) {}

  @Get(":id")
  async get(@CurrentActor() actor: Actor, @Param("id") id: string) {
    return this.environments.presentJob(await this.find(actor, id));
  }

  @Get(":id/logs")
  @Header("Content-Type", "text/plain; charset=utf-8")
  @Header("X-Content-Type-Options", "nosniff")
  async logsText(@CurrentActor() actor: Actor, @Param("id") id: string) {
    await this.find(actor, id);
    return this.logs.read(id);
  }

  /**
   * Streams the job log (server-sent events): what was written so far, then
   * each new line, until the job ends.
   */
  @Sse(":id/logs/stream")
  async logsStream(@CurrentActor() actor: Actor, @Param("id") id: string): Promise<Observable<MessageEvent>> {
    await this.find(actor, id);
    const isFinished = async () => {
      const job = await this.prisma.job.findUnique({ where: { id }, select: { status: true } });
      return !job || FINISHED.includes(job.status);
    };
    return this.logs.follow(id, isFinished).pipe(map((data) => ({ data })));
  }

  private async find(actor: Actor, id: string) {
    const job = await this.prisma.job.findUnique({ where: { id }, include: { environment: { select: { projectId: true } } } });
    if (!job) {
      throw new NotFoundException(`job "${id}" not found`);
    }
    assertInProject(actor, job.environment.projectId);
    return job;
  }
}
