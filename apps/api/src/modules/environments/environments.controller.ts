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
  UploadedFiles,
  UseInterceptors,
  DefaultValuePipe,
  Header,
  Req,
  Res,
} from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import * as fs from "fs";
import type { Actor } from "../../common/actor";
import { CurrentActor, Scopes } from "../../common/auth.guard";
import type { SourceRequest } from "../engine/pipeline.service";
import { EnvironmentsService, type DeployRequest } from "./environments.service";

interface DeployFields {
  primary?: string;
  sources?: string;
  fresh?: string;
  reseed?: string;
  ttl?: string;
}

const SSE_HEARTBEAT_MS = 15_000;

/**
 * Environments API. Create and update are multipart requests:
 *
 * - primary: JSON { "ref": "feat/login" } to deploy the project repository from git
 * - sources: JSON { "front": { "ref": "develop" } } for the other sources taken from git
 * - files: "primary" and "source:<name>" (gzip tar archives) for sources sent from a worktree
 * - ttl: lifetime of the environment ("24h"), instead of the manifest's
 */
@Controller("v1/envs")
@Scopes("envs:read")
export class EnvironmentsController {
  constructor(private readonly environments: EnvironmentsService) {}

  /**
   * Live environments, newest first. mine=true keeps the actor's own;
   * deleted=true lists those deleted in the last 7 days instead.
   */
  @Get()
  list(
    @CurrentActor() actor: Actor,
    @Query("project") project?: string,
    @Query("slug") slug?: string,
    @Query("mine") mine?: string,
    @Query("deleted") deleted?: string,
  ) {
    if (project && slug) {
      return this.environments.getBySlug(actor, project, slug).then((environment) => [environment]);
    }
    return this.environments.list(actor, { project, mine: mine === "true", deleted: deleted === "true" });
  }

  @Get(":id")
  get(@CurrentActor() actor: Actor, @Param("id") id: string) {
    return this.environments.get(actor, id);
  }

  @Post()
  @Scopes("envs:write")
  @HttpCode(202)
  @UseInterceptors(AnyFilesInterceptor())
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: DeployFields & { project?: string; env?: string; createdVia?: string },
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    return this.withUploads(files, () =>
      this.environments.create(actor, {
        project: body.project ?? "",
        env: body.env ?? "",
        request: this.deployRequest(body, files),
        createdVia: body.createdVia ?? "api",
      }),
    );
  }

  @Post(":id/update")
  @Scopes("envs:write")
  @HttpCode(202)
  @UseInterceptors(AnyFilesInterceptor())
  async update(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: DeployFields, @UploadedFiles() files: Express.Multer.File[] = []) {
    return this.withUploads(files, () => this.environments.update(actor, id, this.deployRequest(body, files)));
  }

  @Delete(":id")
  @Scopes("envs:write")
  @HttpCode(202)
  remove(@CurrentActor() actor: Actor, @Param("id") id: string) {
    return this.environments.enqueue(actor, id, "delete");
  }

  @Post(":id/stop")
  @Scopes("envs:write")
  @HttpCode(202)
  stop(@CurrentActor() actor: Actor, @Param("id") id: string) {
    return this.environments.enqueue(actor, id, "stop");
  }

  @Post(":id/start")
  @Scopes("envs:write")
  @HttpCode(202)
  start(@CurrentActor() actor: Actor, @Param("id") id: string) {
    return this.environments.enqueue(actor, id, "start");
  }

  /**
   * Postpones the expiry: { "ttl": "24h" } makes the environment expire 24
   * hours from now.
   */
  @Post(":id/extend")
  @Scopes("envs:write")
  @HttpCode(200)
  extend(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: { ttl?: unknown }) {
    return this.environments.extend(actor, id, body?.ttl);
  }

  /**
   * Runs a command: { service, argv, timeoutSec, stdin }, stdin in base64.
   */
  @Post(":id/exec")
  @Scopes("envs:exec")
  exec(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: { service?: unknown; argv?: unknown; timeoutSec?: unknown; stdin?: unknown }) {
    return this.environments.exec(actor, id, body ?? {});
  }

  /**
   * Output of the services as JSON lines { service, stream, time, text },
   * merged in time order. service (comma-separated) narrows the services,
   * tail the number of lines (200), since and until a time range (ISO 8601),
   * grep a text to find and errors=true the lines reporting errors.
   * format=text downloads them as a text file. With follow=true, the answer
   * is a stream of server-sent events, one line per event, until the
   * services stop.
   */
  @Get(":id/logs")
  async logLines(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Query() raw: { service?: string; tail?: string; since?: string; until?: string; grep?: string; errors?: string; follow?: string; format?: string },
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const query = this.environments.logQuery(raw);
    if (raw.follow !== "true") {
      const { lines } = await this.environments.logLines(actor, id, query);
      if (raw.format === "text") {
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Content-Disposition", `attachment; filename="${id}-logs.txt"`);
        response.send(lines.map((line) => `${line.time} ${line.service} ${line.stream} | ${line.text}\n`).join(""));
        return;
      }
      response.json({ lines });
      return;
    }

    const start = await this.environments.followLogLines(actor, id, query);
    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("X-Accel-Buffering", "no");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.flushHeaders();

    let closed = false;
    const heartbeat = setInterval(() => response.write(": keep-alive\n\n"), SSE_HEARTBEAT_MS);
    const end = () => {
      if (!closed) {
        closed = true;
        clearInterval(heartbeat);
        response.end();
      }
    };
    let stop: (() => void) | null = null;
    request.on("close", () => {
      stop?.();
      end();
    });
    stop = await start(
      (line) => response.write(`data: ${JSON.stringify(line)}\n\n`),
      () => {
        if (!closed) {
          response.write("event: end\ndata: {}\n\n");
        }
        end();
      },
    );
    if (closed) {
      stop();
    }
  }

  /**
   * Last lines of a service's output, as plain text: it comes from the
   * environment's code and must never be read as a page of the dashboard.
   */
  @Get(":id/logs/:service")
  @Header("Content-Type", "text/plain; charset=utf-8")
  @Header("X-Content-Type-Options", "nosniff")
  logs(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Param("service") service: string,
    @Query("tail", new DefaultValuePipe(200), ParseIntPipe) tail: number,
  ) {
    return this.environments.logs(actor, id, service, tail);
  }

  /**
   * The last jobs of the environment, newest first; the logs of the last
   * five are kept.
   */
  @Get(":id/jobs")
  jobs(@CurrentActor() actor: Actor, @Param("id") id: string) {
    return this.environments.jobs(actor, id);
  }

  /**
   * The containers of the services; usage=true adds their CPU, memory and
   * disk right now.
   */
  @Get(":id/services")
  services(@CurrentActor() actor: Actor, @Param("id") id: string, @Query("usage") usage?: string) {
    return this.environments.services(actor, id, usage === "true");
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

    return { primary, sources, fresh: body.fresh === "true", reseed: body.reseed === "true", ttlSeconds: this.environments.ttlSeconds(body.ttl) };
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
