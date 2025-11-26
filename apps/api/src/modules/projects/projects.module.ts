import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../../entities/project.entity';
import { ProjectResource } from '../../entities/project-resource.entity';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectResourcesController } from './project-resources.controller';
import { ProjectResourcesService } from './project-resources.service';

@Module({
  imports: [TypeOrmModule.forFeature([Project, ProjectResource])],
  controllers: [ProjectsController, ProjectResourcesController],
  providers: [ProjectsService, ProjectResourcesService],
  exports: [ProjectsService, ProjectResourcesService],
})
export class ProjectsModule {}
