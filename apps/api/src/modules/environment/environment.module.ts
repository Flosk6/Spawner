import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EnvironmentController } from './environment.controller';
import { EnvironmentService } from './environment.service';
import { Environment } from '../../entities/environment.entity';
import { EnvironmentResource } from '../../entities/environment-resource.entity';
import { Project } from '../../entities/project.entity';
import { ProjectResource } from '../../entities/project-resource.entity';
import { GitModule } from '../git/git.module';
import { ProjectsModule } from '../projects/projects.module';
import { EnvironmentLogsEmitter } from '../../common/environment-logs.emitter';
import { DockerService } from '../../common/docker.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Environment, EnvironmentResource, Project, ProjectResource]),
    GitModule,
    ProjectsModule,
  ],
  controllers: [EnvironmentController],
  providers: [EnvironmentService, EnvironmentLogsEmitter, DockerService],
})
export class EnvironmentModule {}
