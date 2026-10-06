import { BadRequestException, Body, Controller, Get, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Actor } from "../../common/actor";
import { CurrentActor, Scopes } from "../../common/auth.guard";
import { AuditService } from "../audit/audit.service";
import { GitKeysService, type RepoKeyInfo } from "../engine/git-keys.service";
import { GitMirrorService } from "../engine/git-mirror.service";

/**
 * Deploy keys and repository checks, used by the Git settings page (admins).
 */
@Controller("v1/git")
@Scopes("admin")
export class GitController {
  constructor(
    private readonly keys: GitKeysService,
    private readonly git: GitMirrorService,
    private readonly audit: AuditService,
  ) {}

  @Get("key")
  @Throttle({ long: { limit: 100, ttl: 60000 } })
  getKey() {
    return this.keys.globalKeyInfo();
  }

  @Post("key/generate")
  @Throttle({ short: { limit: 5, ttl: 3600000 } })
  async generateKey(@CurrentActor() actor: Actor) {
    try {
      const key = await this.keys.generateGlobalKey();
      await this.audit.record(actor, "git.key", { target: "global" });
      return key;
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
  async generateKeyForRepo(@CurrentActor() actor: Actor, @Body() body: { gitRepo?: string }) {
    const repo = this.repo(body);
    try {
      this.git.validateRepoUrl(repo);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const key = await this.keys.generateKeyForRepo(repo);
    await this.audit.record(actor, "git.key", { target: repo });
    return key;
  }

  private repo(body: { gitRepo?: string }): string {
    if (!body?.gitRepo) {
      throw new BadRequestException("gitRepo is required");
    }
    return body.gitRepo;
  }
}
