import { Module } from '@nestjs/common';
import { EnvironmentController } from './environment.controller';
import { EnvironmentService } from './environment.service';
import { GitModule } from '../git/git.module';
import { ProjectsModule } from '../projects/projects.module';
import { StatsModule } from '../stats/stats.module';
import { EnvironmentLogsEmitter } from '../../common/environment-logs.emitter';
import { DockerService } from '../../common/docker.service';

@Module({
  imports: [
    GitModule,
    ProjectsModule,
    StatsModule,
  ],
  controllers: [EnvironmentController],
  providers: [EnvironmentService, EnvironmentLogsEmitter, DockerService],
})
export class EnvironmentModule {}
