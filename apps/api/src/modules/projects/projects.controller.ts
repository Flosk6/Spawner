import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiAuthGuard } from "../../common/api-auth.guard";
import { ProjectsService, type ProjectInput } from "./projects.service";

@Controller("v1/projects")
@UseGuards(ApiAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list() {
    return this.projects.list();
  }

  @Get(":slug")
  get(@Param("slug") slug: string) {
    return this.projects.get(slug);
  }

  @Post()
  create(@Body() body: ProjectInput) {
    return this.projects.create(body ?? {});
  }

  @Patch(":slug")
  update(@Param("slug") slug: string, @Body() body: ProjectInput) {
    return this.projects.update(slug, body ?? {});
  }

  @Delete(":slug")
  @HttpCode(204)
  async remove(@Param("slug") slug: string) {
    await this.projects.remove(slug);
  }
}
