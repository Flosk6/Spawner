import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  DefaultValuePipe,
  Header,
} from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import * as fs from "fs";
import { ApiAuthGuard, type ApiActor } from "../../common/api-auth.guard";
import type { SourceRequest } from "../engine/pipeline.service";
import { EnvironmentsService, type DeployRequest } from "./environments.service";

interface DeployFields {
  primary?: string;
  sources?: string;
  fresh?: string;
  reseed?: string;
}

/**
 * Environments API. Create and update are multipart requests:
 *
 * - primary: JSON { "ref": "feat/login" } to deploy the project repository from git
 * - sources: JSON { "front": { "ref": "develop" } } for the other sources taken from git
 * - files: "primary" and "source:<name>" (gzip tar archives) for sources sent from a worktree
 */
@Controller("v1/envs")
@UseGuards(ApiAuthGuard)
export class EnvironmentsController {
  constructor(private readonly environments: EnvironmentsService) {}

  @Get()
  list(@Query("project") project?: string, @Query("slug") slug?: string) {
    if (project && slug) {
      return this.environments.getBySlug(project, slug).then((environment) => [environment]);
    }
    return this.environments.list(project);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.environments.get(id);
  }

  @Post()
  @HttpCode(202)
  @UseInterceptors(AnyFilesInterceptor())
  async create(
    @Body() body: DeployFields & { project?: string; env?: string; createdVia?: string },
    @UploadedFiles() files: Express.Multer.File[] = [],
    @Req() request: { actor: ApiActor },
  ) {
    return this.withUploads(files, () =>
      this.environments.create({
        project: body.project ?? "",
        env: body.env ?? "",
        request: this.deployRequest(body, files),
        createdVia: body.createdVia ?? "api",
        actorId: request.actor.userId,
      }),
    );
  }

  @Post(":id/update")
  @HttpCode(202)
  @UseInterceptors(AnyFilesInterceptor())
  async update(
    @Param("id") id: string,
    @Body() body: DeployFields,
    @UploadedFiles() files: Express.Multer.File[] = [],
    @Req() request: { actor: ApiActor },
  ) {
    return this.withUploads(files, () => this.environments.update(id, this.deployRequest(body, files), request.actor.userId));
  }

  @Delete(":id")
  @HttpCode(202)
  remove(@Param("id") id: string, @Req() request: { actor: ApiActor }) {
    return this.environments.enqueue(id, "delete", request.actor.userId);
  }

  @Post(":id/stop")
  @HttpCode(202)
  stop(@Param("id") id: string, @Req() request: { actor: ApiActor }) {
    return this.environments.enqueue(id, "stop", request.actor.userId);
  }

  @Post(":id/start")
  @HttpCode(202)
  start(@Param("id") id: string, @Req() request: { actor: ApiActor }) {
    return this.environments.enqueue(id, "start", request.actor.userId);
  }

  @Post(":id/exec")
  exec(@Param("id") id: string, @Body() body: { service?: unknown; argv?: unknown; timeoutSec?: unknown }) {
    return this.environments.exec(id, body ?? {});
  }

  /**
   * Last lines of a service's output, as plain text: it comes from the
   * environment's code and must never be read as a page of the dashboard.
   */
  @Get(":id/logs/:service")
  @Header("Content-Type", "text/plain; charset=utf-8")
  @Header("X-Content-Type-Options", "nosniff")
  logs(
    @Param("id") id: string,
    @Param("service") service: string,
    @Query("tail", new DefaultValuePipe(200), ParseIntPipe) tail: number,
  ) {
    return this.environments.logs(id, service, tail);
  }

  @Get(":id/services")
  services(@Param("id") id: string) {
    return this.environments.services(id);
  }

  @Get(":id/stats")
  stats(@Param("id") id: string, @Query("minutes", new DefaultValuePipe(60), ParseIntPipe) minutes: number) {
    return this.environments.usage(id, minutes);
  }

  /**
   * Builds the deploy request: uploaded files decide which sources come from
   * a worktree, the JSON fields give the git refs of the others.
   */
  private deployRequest(body: DeployFields, files: Express.Multer.File[]): DeployRequest {
    const primaryFields = this.json<{ ref?: string }>(body.primary, "primary");
    const sourceFields = this.json<Record<string, { ref?: string }>>(body.sources, "sources");

    const primary: SourceRequest = { origin: "git", ref: primaryFields.ref };
    const sources: Record<string, SourceRequest> = Object.fromEntries(
      Object.entries(sourceFields).map(([name, fields]) => [name, { origin: "git", ref: fields?.ref }]),
    );

    for (const file of files) {
      if (file.fieldname === "primary") {
        primary.origin = "upload";
        primary.archive = file.path;
        delete primary.ref;
      } else if (file.fieldname.startsWith("source:")) {
        sources[file.fieldname.slice("source:".length)] = { origin: "upload", archive: file.path };
      } else {
        throw new BadRequestException(`unexpected file field "${file.fieldname}" (use "primary" or "source:<name>")`);
      }
    }

    return { primary, sources, fresh: body.fresh === "true", reseed: body.reseed === "true" };
  }

  private json<T>(value: string | undefined, field: string): T {
    if (value === undefined || value === "") {
      return {} as T;
    }
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
      return parsed as T;
    } catch {
      throw new BadRequestException(`${field} must be a JSON object`);
    }
  }

  /**
   * Deletes the uploaded archives when the request is refused; once a job is
   * queued, the job owns them and removes them when it ends.
   */
  private async withUploads<T>(files: Express.Multer.File[], work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      files.forEach((file) => fs.rmSync(file.path, { force: true }));
      throw error;
    }
  }
}
