import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  ParseIntPipe,
} from '@nestjs/common';
import { ProjectResourcesService } from './project-resources.service';

@Controller('projects/:projectId/resources')
export class ProjectResourcesController {
  constructor(private readonly resourcesService: ProjectResourcesService) {}

  @Get()
  async findAll(@Param('projectId', ParseIntPipe) projectId: number) {
    return this.resourcesService.findAll(projectId);
  }

  @Post()
  async create(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() data: {
      name: string;
      type: 'laravel-api' | 'nextjs-front' | 'mysql-db';
      gitRepo?: string;
      defaultBranch?: string;
      dbResourceId?: number;
      apiResourceId?: number;
      staticEnvVars?: string;
    },
  ) {
    return this.resourcesService.create(projectId, data);
  }

  @Put(':id')
  async update(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() data: {
      name?: string;
      type?: 'laravel-api' | 'nextjs-front' | 'mysql-db';
      gitRepo?: string;
      defaultBranch?: string;
      dbResourceId?: number;
      apiResourceId?: number;
      staticEnvVars?: string;
      postBuildCommands?: string[];
    },
  ) {
    return this.resourcesService.update(projectId, id, data);
  }

  @Delete(':id')
  async delete(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.resourcesService.delete(projectId, id);
    return { success: true };
  }
}
