import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ProjectsService } from './projects.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';

@Controller('projects')
@UseGuards(SessionAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @Throttle({ long: { limit: 100, ttl: 60000 } })
  async findAll() {
    return this.projectsService.findAll();
  }

  @Get(':id')
  @Throttle({ long: { limit: 100, ttl: 60000 } })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.projectsService.findOne(id);
  }

  @Post()
  @Throttle({ medium: { limit: 20, ttl: 3600000 } })
  async create(
    @Body() data: { name: string; baseDomain: string },
  ) {
    return this.projectsService.create(data);
  }

  @Put(':id')
  @Throttle({ medium: { limit: 50, ttl: 3600000 } })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { name?: string; baseDomain?: string },
  ) {
    return this.projectsService.update(id, data);
  }

  @Delete(':id')
  @Throttle({ medium: { limit: 20, ttl: 3600000 } })
  async delete(@Param('id', ParseIntPipe) id: number) {
    await this.projectsService.delete(id);
    return { success: true };
  }
}
