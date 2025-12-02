import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  Sse,
  MessageEvent,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { EnvironmentService } from "./environment.service";
import { CreateEnvironmentDto } from "./dto/create-environment.dto";
import { UpdateEnvironmentDto } from "./dto/update-environment.dto";
import { Observable } from "rxjs";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";

@Controller()
@UseGuards(SessionAuthGuard)
export class EnvironmentController {
  constructor(private readonly environmentService: EnvironmentService) {}

  @Get("environments")
  @Throttle({ long: { limit: 100, ttl: 60000 } })
  findAll() {
    return this.environmentService.findAll();
  }

  @Get("environments/:id")
  @Throttle({ long: { limit: 100, ttl: 60000 } })
  findOne(@Param("id") id: string) {
    return this.environmentService.findOne(id);
  }

  @Get("projects/:projectId/environments")
  @Throttle({ long: { limit: 100, ttl: 60000 } })
  findByProject(@Param("projectId", ParseIntPipe) projectId: number) {
    return this.environmentService.findByProject(projectId);
  }

  @Post("projects/:projectId/environments")
  @Throttle({ short: { limit: 10, ttl: 3600000 } })
  createForProject(
    @Param("projectId", ParseIntPipe) projectId: number,
    @Body() dto: CreateEnvironmentDto
  ) {
    return this.environmentService.createForProject(
      projectId,
      dto.name,
      dto.branches,
      dto.localMode
    );
  }

  @Delete("environments/:id")
  @Throttle({ medium: { limit: 30, ttl: 3600000 } })
  delete(@Param("id") id: string) {
    return this.environmentService.delete(id);
  }

  @Get("environments/:id/logs/:resourceName")
  @Throttle({ medium: { limit: 50, ttl: 60000 } })
  getLogs(
    @Param("id") id: string,
    @Param("resourceName") resourceName: string
  ) {
    return this.environmentService.getLogs(id, resourceName);
  }

  @Post("environments/:id/exec/:resourceName")
  @Throttle({ short: { limit: 20, ttl: 60000 } })
  execCommand(
    @Param("id") id: string,
    @Param("resourceName") resourceName: string,
    @Body() body: { command: string }
  ) {
    return this.environmentService.execCommand(id, resourceName, body.command);
  }

  @Get("environments/:id/logs-stream/:resourceName")
  @Throttle({ medium: { limit: 50, ttl: 60000 } })
  streamLogs(
    @Param("id") id: string,
    @Param("resourceName") resourceName: string
  ) {
    return this.environmentService.streamLogs(id, resourceName);
  }

  @Sse("environments/creation-logs/:environmentId")
  @Throttle({ long: { limit: 100, ttl: 60000 } })
  streamCreationLogs(
    @Param("environmentId") environmentId: string
  ): Observable<MessageEvent> {
    return this.environmentService.streamCreationLogs(environmentId);
  }

  @Sse("environments/update-logs/:environmentId")
  @Throttle({ long: { limit: 100, ttl: 60000 } })
  streamUpdateLogs(
    @Param("environmentId") environmentId: string
  ): Observable<MessageEvent> {
    return this.environmentService.streamCreationLogs(environmentId);
  }

  @Get("environments/:id/build-logs")
  @Throttle({ long: { limit: 100, ttl: 60000 } })
  getBuildLogs(@Param("id") id: string) {
    return this.environmentService.getBuildLogs(id);
  }

  @Get("environments/:id/stats")
  @Throttle({ long: { limit: 100, ttl: 60000 } })
  getStats(@Param("id") id: string) {
    return this.environmentService.getStats(id);
  }

  @Get("environments/:id/stats/history")
  @Throttle({ long: { limit: 100, ttl: 60000 } })
  getStatsHistory(@Param("id") id: string) {
    return this.environmentService.getStatsHistory(id);
  }

  @Post("environments/:id/pause")
  @Throttle({ medium: { limit: 20, ttl: 3600000 } })
  pause(@Param("id") id: string) {
    return this.environmentService.pause(id);
  }

  @Post("environments/:id/resume")
  @Throttle({ medium: { limit: 20, ttl: 3600000 } })
  resume(@Param("id") id: string) {
    return this.environmentService.resume(id);
  }

  @Post("environments/:id/restart")
  @Throttle({ medium: { limit: 20, ttl: 3600000 } })
  restart(@Param("id") id: string) {
    return this.environmentService.restart(id);
  }

  @Post("environments/:id/update")
  @Throttle({ short: { limit: 10, ttl: 3600000 } })
  update(@Param("id") id: string, @Body() dto: UpdateEnvironmentDto) {
    return this.environmentService.update(id, dto.branches);
  }

  @Post("environments/:id/resources/:resourceName/restart")
  @Throttle({ medium: { limit: 30, ttl: 3600000 } })
  restartResource(
    @Param("id") id: string,
    @Param("resourceName") resourceName: string
  ) {
    return this.environmentService.restartResource(id, resourceName);
  }
}
