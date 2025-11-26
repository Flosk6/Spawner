import { Controller, Get, Post, Body, BadRequestException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GitService } from './git.service';
import { GitKeysService, RepoKeyInfo } from './git-keys.service';
import { ConfigService } from '../../config/config.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';

@Controller('git')
@UseGuards(SessionAuthGuard)
export class GitController {
  constructor(
    private readonly gitService: GitService,
    private readonly gitKeysService: GitKeysService,
    private readonly configService: ConfigService,
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
  async testConnection(@Body() body: { resourceName?: string; gitRepo?: string }) {
    let gitRepo: string;

    if (body.gitRepo) {
      gitRepo = body.gitRepo;
    } else if (body.resourceName) {
      const resource = this.configService.getResourceByName(body.resourceName);
      if (!resource) {
        throw new BadRequestException(`Resource not found: ${body.resourceName}`);
      }
      if (!resource.gitRepo) {
        throw new BadRequestException(`Resource ${body.resourceName} has no git repository`);
      }
      gitRepo = resource.gitRepo;
    } else {
      throw new BadRequestException('Either resourceName or gitRepo is required');
    }

    return this.gitService.testConnection(gitRepo);
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
