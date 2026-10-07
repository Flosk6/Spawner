import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Actor } from "../../common/actor";
import { CurrentActor, Scopes } from "../../common/auth.guard";
import { ProjectsService, type ProjectInput } from "./projects.service";

/**
 * Projects: everyone reads them, admins change them.
 */
@Controller("v1/projects")
@Scopes("envs:read")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.projects.list(actor);
  }

  /**
   * A project, with the names of its variables.
   */
  @Get(":slug")
  get(@CurrentActor() actor: Actor, @Param("slug") slug: string) {
    return this.projects.describe(slug, actor);
  }

  /**
   * Branches of the project repository, or of another source of
   * spawner.yaml (?source=front), for the new environment form.
   */
  @Get(":slug/branches")
  @Throttle({ short: { limit: 10, ttl: 10_000 } })
  async branches(@CurrentActor() actor: Actor, @Param("slug") slug: string, @Query("source") source?: string) {
    return { branches: await this.projects.branches(slug, actor, source) };
  }

  /**
   * spawner.yaml at a ref (the default branch otherwise): its sources and
   * exposures.
   */
  @Get(":slug/manifest")
  @Throttle({ short: { limit: 10, ttl: 10_000 } })
  manifest(@CurrentActor() actor: Actor, @Param("slug") slug: string, @Query("ref") ref?: string) {
    return this.projects.manifest(slug, actor, ref);
  }

  @Get(":slug/variables")
  @Scopes("admin")
  variables(@Param("slug") slug: string) {
    return this.projects.variables(slug);
  }

  /**
   * Sets a variable: { "value": "...", "secret": true }.
   */
  @Put(":slug/variables/:name")
  @Scopes("admin")
  setVariable(@CurrentActor() actor: Actor, @Param("slug") slug: string, @Param("name") name: string, @Body() body: { value?: unknown; secret?: unknown }) {
    return this.projects.setVariable(actor, slug, name, body ?? {});
  }

  @Delete(":slug/variables/:name")
  @Scopes("admin")
  @HttpCode(204)
  deleteVariable(@CurrentActor() actor: Actor, @Param("slug") slug: string, @Param("name") name: string) {
    return this.projects.deleteVariable(actor, slug, name);
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
