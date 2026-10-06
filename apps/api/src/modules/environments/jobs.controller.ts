import { Controller, Get, Header, MessageEvent, NotFoundException, Param, Sse, UseGuards } from "@nestjs/common";
import { Observable, map } from "rxjs";
import { ApiAuthGuard } from "../../common/api-auth.guard";
import { PrismaService } from "../../common/prisma.service";
import { JobLogsService } from "../engine/job-logs.service";
import { EnvironmentsService } from "./environments.service";

const FINISHED = ["succeeded", "failed", "cancelled"];

@Controller("v1/jobs")
@UseGuards(ApiAuthGuard)
export class JobsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logs: JobLogsService,
    private readonly environments: EnvironmentsService,
  ) {}

  @Get(":id")
  async get(@Param("id") id: string) {
    return this.environments.presentJob(await this.find(id));
  }

  @Get(":id/logs")
  @Header("Content-Type", "text/plain; charset=utf-8")
  @Header("X-Content-Type-Options", "nosniff")
  async logsText(@Param("id") id: string) {
    await this.find(id);
    return this.logs.read(id);
  }

  /**
   * Streams the job log (server-sent events): what was written so far, then
   * each new line, until the job ends.
   */
  @Sse(":id/logs/stream")
  async logsStream(@Param("id") id: string): Promise<Observable<MessageEvent>> {
    await this.find(id);
    const isFinished = async () => {
      const job = await this.prisma.job.findUnique({ where: { id }, select: { status: true } });
      return !job || FINISHED.includes(job.status);
    };
    return this.logs.follow(id, isFinished).pipe(map((data) => ({ data })));
  }

  private async find(id: string) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) {
      throw new NotFoundException(`job "${id}" not found`);
    }
    return job;
  }
}
