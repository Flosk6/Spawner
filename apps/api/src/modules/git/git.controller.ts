import { BadRequestException, Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { GitKeysService, type RepoKeyInfo } from "../engine/git-keys.service";
import { GitMirrorService } from "../engine/git-mirror.service";

/**
 * Deploy keys and repository checks, used by the Git settings page.
 */
@Controller("git")
@UseGuards(SessionAuthGuard)
export class GitController {
  constructor(
    private readonly keys: GitKeysService,
    private readonly git: GitMirrorService,
  ) {}

  @Get("key")
  @Throttle({ long: { limit: 100, ttl: 60000 } })
  getKey() {
    return this.keys.globalKeyInfo();
  }

  @Post("key/generate")
  @Throttle({ short: { limit: 5, ttl: 3600000 } })
  async generateKey() {
    try {
      return await this.keys.generateGlobalKey();
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("test")
  @Throttle({ medium: { limit: 30, ttl: 3600000 } })
  testConnection(@Body() body: { gitRepo?: string }) {
    return this.git.testAccess(this.repo(body));
  }

  @Get("keys/repos")
  @Throttle({ long: { limit: 100, ttl: 60000 } })
  listRepos(): Promise<RepoKeyInfo[]> {
    return this.keys.listRepos();
  }

  @Post("keys/generate")
  @Throttle({ short: { limit: 10, ttl: 3600000 } })
  generateKeyForRepo(@Body() body: { gitRepo?: string }) {
    const repo = this.repo(body);
    try {
      this.git.validateRepoUrl(repo);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    return this.keys.generateKeyForRepo(repo);
  }

  @Post("branches")
  @Throttle({ medium: { limit: 30, ttl: 60000 } })
  async listBranches(@Body() body: { gitRepo?: string }) {
    try {
      return { branches: await this.git.listBranches(this.repo(body)) };
    } catch (error) {
      throw new BadRequestException(`Unable to list branches: ${(error as Error).message.split("\n")[0]}`);
    }
  }

  private repo(body: { gitRepo?: string }): string {
    if (!body?.gitRepo) {
      throw new BadRequestException("gitRepo is required");
    }
    return body.gitRepo;
  }
}
