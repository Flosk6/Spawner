import { Controller, Get, Post, Body, BadRequestException } from '@nestjs/common';
import { GitService } from './git.service';
import { GitKeysService, RepoKeyInfo } from './git-keys.service';
import { ConfigService } from '../../config/config.service';

@Controller('git')
export class GitController {
  constructor(
    private readonly gitService: GitService,
    private readonly gitKeysService: GitKeysService,
    private readonly configService: ConfigService,
  ) {}

  @Get('key')
  async getKey() {
    return this.gitService.getKeyInfo();
  }

  @Post('key/generate')
  async generateKey() {
    return this.gitService.generateKey();
  }

  @Post('test')
  async testConnection(@Body() body: { resourceName?: string; gitRepo?: string }) {
    let gitRepo: string;

    if (body.gitRepo) {
      // Direct git repo URL provided
      gitRepo = body.gitRepo;
    } else if (body.resourceName) {
      // Legacy: resource name provided
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

  // New per-repo key management endpoints

  @Get('keys/repos')
  async getAllReposWithKeys(): Promise<RepoKeyInfo[]> {
    return this.gitKeysService.getAllReposWithKeys();
  }

  @Post('keys/generate')
  async generateKeyForRepo(@Body() body: { gitRepo: string }) {
    if (!body.gitRepo) {
      throw new BadRequestException('gitRepo is required');
    }

    return this.gitKeysService.generateKeyForRepo(body.gitRepo);
  }
}
