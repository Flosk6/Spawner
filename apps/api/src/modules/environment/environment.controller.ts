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
}
