import { Controller, Get, Post, Body, BadRequestException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GitService } from './git.service';
import { GitKeysService, RepoKeyInfo } from './git-keys.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';

@Controller('git')
@UseGuards(SessionAuthGuard)
export class GitController {
  constructor(
    private readonly gitService: GitService,
    private readonly gitKeysService: GitKeysService,
  ) {}

  @Get('key')
  @Throttle({ long: { limit: 100, ttl: 60000 } })
  async getKey() {
    return this.gitService.getKeyInfo();
  }

  @Post('key/generate')
  @Throttle({ short: { limit: 5, ttl: 3600000 } })
  async generateKey() {
    return this.gitService.generateKey();
  }

  @Post('test')
  @Throttle({ medium: { limit: 30, ttl: 3600000 } })
  async testConnection(@Body() body: { gitRepo: string }) {
    if (!body.gitRepo) {
      throw new BadRequestException('gitRepo is required');
    }

    return this.gitService.testConnection(body.gitRepo);
  }

  @Get('keys/repos')
  @Throttle({ long: { limit: 100, ttl: 60000 } })
  async getAllReposWithKeys(): Promise<RepoKeyInfo[]> {
    return this.gitKeysService.getAllReposWithKeys();
  }

  @Post('keys/generate')
  @Throttle({ short: { limit: 10, ttl: 3600000 } })
  async generateKeyForRepo(@Body() body: { gitRepo: string }) {
    if (!body.gitRepo) {
      throw new BadRequestException('gitRepo is required');
    }

    return this.gitKeysService.generateKeyForRepo(body.gitRepo);
  }
}
