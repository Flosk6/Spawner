import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GitController } from './git.controller';
import { GitService } from './git.service';
import { GitKeysService } from './git-keys.service';
import { Setting } from '../../entities/setting.entity';
import { ProjectResource } from '../../entities/project-resource.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Setting, ProjectResource])],
  controllers: [GitController],
  providers: [GitService, GitKeysService],
  exports: [GitService, GitKeysService],
})
export class GitModule {}
