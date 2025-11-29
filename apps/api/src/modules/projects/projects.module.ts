import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectResourcesController } from './project-resources.controller';
import { ProjectResourcesService } from './project-resources.service';

@Module({
  controllers: [ProjectsController, ProjectResourcesController],
  providers: [ProjectsService, ProjectResourcesService],
  exports: [ProjectsService, ProjectResourcesService],
})
export class ProjectsModule {}
