import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Actor } from "../../common/actor";
import { CurrentActor, Scopes } from "../../common/auth.guard";
import { GitMirrorService } from "../engine/git-mirror.service";
import { ProjectsService, type ProjectInput } from "./projects.service";

/**
 * Projects: everyone reads them, admins change them.
 */
@Controller("v1/projects")
@Scopes("envs:read")
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly git: GitMirrorService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.projects.list(actor);
  }

  @Get(":slug")
  get(@CurrentActor() actor: Actor, @Param("slug") slug: string) {
    return this.projects.get(slug, actor);
  }

  /**
   * Branches of the project repository, for the new environment form.
   */
  @Get(":slug/branches")
  @Throttle({ short: { limit: 10, ttl: 10_000 } })
  async branches(@CurrentActor() actor: Actor, @Param("slug") slug: string) {
    const project = await this.projects.get(slug, actor);
    try {
      return { branches: await this.git.listBranches(project.repoUrl) };
    } catch (error) {
      throw new BadRequestException(`Unable to list branches: ${(error as Error).message.split("\n")[0]}`);
    }
  }

  @Post()
  @Scopes("admin")
  create(@CurrentActor() actor: Actor, @Body() body: ProjectInput) {
    return this.projects.create(actor, body ?? {});
  }

  @Patch(":slug")
  @Scopes("admin")
  update(@CurrentActor() actor: Actor, @Param("slug") slug: string, @Body() body: ProjectInput) {
    return this.projects.update(actor, slug, body ?? {});
  }

  @Delete(":slug")
  @Scopes("admin")
  @HttpCode(204)
  async remove(@CurrentActor() actor: Actor, @Param("slug") slug: string) {
    await this.projects.remove(actor, slug);
  }
}
