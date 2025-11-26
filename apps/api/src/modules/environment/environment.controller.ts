import { Controller, Get, Post, Delete, Param, Body, ParseIntPipe, Sse, MessageEvent } from '@nestjs/common';
import { EnvironmentService } from './environment.service';
import { CreateEnvironmentDto } from './dto/create-environment.dto';
import { Observable } from 'rxjs';

@Controller()
export class EnvironmentController {
  constructor(private readonly environmentService: EnvironmentService) {}

  // Legacy endpoint - all environments
  @Get('environments')
  findAll() {
    return this.environmentService.findAll();
  }

  @Get('environments/:id')
  findOne(@Param('id') id: string) {
    return this.environmentService.findOne(id);
  }

  // New endpoint - environments for a specific project
  @Get('projects/:projectId/environments')
  findByProject(@Param('projectId', ParseIntPipe) projectId: number) {
    return this.environmentService.findByProject(projectId);
  }

  // New endpoint - create environment for a project
  @Post('projects/:projectId/environments')
  createForProject(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: CreateEnvironmentDto,
  ) {
    return this.environmentService.createForProject(projectId, dto.name, dto.branches, dto.localMode);
  }

  @Delete('environments/:id')
  delete(@Param('id') id: string) {
    return this.environmentService.delete(id);
  }

  @Get('environments/:id/logs/:resourceName')
  getLogs(@Param('id') id: string, @Param('resourceName') resourceName: string) {
    return this.environmentService.getLogs(id, resourceName);
  }

  @Post('environments/:id/exec/:resourceName')
  execCommand(
    @Param('id') id: string,
    @Param('resourceName') resourceName: string,
    @Body() body: { command: string },
  ) {
    return this.environmentService.execCommand(id, resourceName, body.command);
  }

  @Get('environments/:id/logs-stream/:resourceName')
  streamLogs(@Param('id') id: string, @Param('resourceName') resourceName: string) {
    return this.environmentService.streamLogs(id, resourceName);
  }

  @Sse('environments/creation-logs/:environmentId')
  streamCreationLogs(@Param('environmentId') environmentId: string): Observable<MessageEvent> {
    return this.environmentService.streamCreationLogs(environmentId);
  }
}
