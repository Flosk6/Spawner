import { Module } from '@nestjs/common';
import { GitController } from './git.controller';
import { GitService } from './git.service';
import { GitKeysService } from './git-keys.service';

@Module({
  controllers: [GitController],
  providers: [GitService, GitKeysService],
  exports: [GitService, GitKeysService],
})
export class GitModule {}
