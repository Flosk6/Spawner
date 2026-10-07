import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Project } from "@prisma/client";
import * as path from "path";
import { MANIFEST_PATH, parseManifest, slugIssue } from "@spawner/core";
import { sanitizeGitBranch } from "@spawner/utils";
import { assertInProject, type Actor } from "../../common/actor";
import { PrismaService } from "../../common/prisma.service";
import { SecretsService } from "../../common/secrets.service";
import { AuditService } from "../audit/audit.service";
import { GitMirrorService } from "../engine/git-mirror.service";

export interface ProjectInput {
  slug?: string;
  name?: string;
  repoUrl?: string;
  defaultRef?: string;
  rootDir?: string;
  allowPublic?: boolean;
  allowAlwaysOn?: boolean;
}

const VARIABLE_NAME = /^[A-Z_][A-Z0-9_]*$/;
const MAX_VARIABLE_BYTES = 64 * 1024;

/**
 * Projects: a repository holding .spawner/spawner.yaml (in rootDir, for
 * monorepos) and the branch environments start from by default.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly git: GitMirrorService,
    private readonly audit: AuditService,
    private readonly secrets: SecretsService,
  ) {}

  async list(actor: Actor) {
    const projects = await this.prisma.project.findMany({
      where: actor.projectId ? { id: actor.projectId } : {},
      orderBy: { slug: "asc" },
      include: { _count: { select: { environments: { where: { deletedAt: null } } } } },
    });
    return projects.map(({ _count, ...project }) => ({ ...project, environmentCount: _count.environments }));
  }

  /**
   * A project as the API shows it, with the names of its variables (their
   * values stay with the admins).
   */
  async describe(slug: string, actor: Actor) {
    const project = await this.get(slug, actor);
    const variables = await this.prisma.projectVariable.findMany({ where: { projectId: project.id }, orderBy: { name: "asc" }, select: { name: true, secret: true } });
    return { ...project, variables };
  }

  /**
   * spawner.yaml at a branch, tag or commit (the default branch otherwise),
   * read from the repository: what the new environment form needs, the
   * other sources and their default branches.
   */
  async manifest(slug: string, actor: Actor, ref?: string) {
    const project = await this.get(slug, actor);
    const at = ref || project.defaultRef;
    const file = path.posix.join(project.rootDir, MANIFEST_PATH);
    let text: string | null;
    try {
      text = await this.git.readFile(project.repoUrl, at, file);
    } catch (error) {
      throw new BadRequestException(`Unable to read the repository: ${(error as Error).message.split("\n")[0]}`);
    }
    if (text === null) {
      throw new NotFoundException(`${file} does not exist at ${at}`);
    }
    const { manifest, issues } = parseManifest(text);
    return {
      ref: at,
      name: manifest?.name ?? null,
      sources: Object.entries(manifest?.sources ?? {}).map(([name, source]) => ({ name, repo: source.repo, defaultRef: source.defaultRef })),
      exposures: manifest?.exposures ?? [],
      issues,
    };
  }

  /**
   * Branches of the project repository, or of one of its other sources.
   */
  async branches(slug: string, actor: Actor, source?: string): Promise<string[]> {
    const project = await this.get(slug, actor);
    let repoUrl = project.repoUrl;
    if (source) {
      const manifest = await this.manifest(slug, actor);
      if (source !== manifest.name) {
        const declared = manifest.sources.find((candidate) => candidate.name === source);
        if (!declared) {
          throw new NotFoundException(`spawner.yaml declares no source "${source}"`);
        }
        repoUrl = declared.repo;
      }
    }
    try {
      return await this.git.listBranches(repoUrl);
    } catch (error) {
      throw new BadRequestException(`Unable to list branches: ${(error as Error).message.split("\n")[0]}`);
    }
  }

  /**
   * The variables of a project, for its admins: secret values are never
   * shown again.
   */
  async variables(slug: string) {
    const project = await this.get(slug);
    const variables = await this.prisma.projectVariable.findMany({ where: { projectId: project.id }, orderBy: { name: "asc" } });
    return variables.map((variable) => ({ name: variable.name, secret: variable.secret, value: variable.secret ? null : variable.value, updatedAt: variable.updatedAt }));
  }

  /**
   * Sets a variable the compose files of the project can use as ${NAME}.
   * A secret value is stored encrypted and masked in job logs.
   */
  async setVariable(actor: Actor, slug: string, name: string, input: { value?: unknown; secret?: unknown }) {
    const project = await this.get(slug);
    if (!VARIABLE_NAME.test(name) || name.startsWith("SPAWNER_")) {
      throw new BadRequestException("variable names use uppercase letters, digits and underscores, and do not start with SPAWNER_");
    }
    if (typeof input.value !== "string" || Buffer.byteLength(input.value) > MAX_VARIABLE_BYTES) {
      throw new BadRequestException("value must be a string of 64 KiB at most");
    }
    const secret = input.secret === true;
    const value = secret ? this.secrets.encrypt(input.value) : input.value;
    await this.prisma.projectVariable.upsert({
      where: { projectId_name: { projectId: project.id, name } },
      create: { projectId: project.id, name, value, secret },
      update: { value, secret },
    });
    await this.audit.record(actor, "project.variable_set", { target: slug, details: { name, secret } });
    return (await this.variables(slug)).find((variable) => variable.name === name);
  }

  async deleteVariable(actor: Actor, slug: string, name: string): Promise<void> {
    const project = await this.get(slug);
    const { count } = await this.prisma.projectVariable.deleteMany({ where: { projectId: project.id, name } });
    if (count === 0) {
      throw new NotFoundException(`project "${slug}" has no variable ${name}`);
    }
    await this.audit.record(actor, "project.variable_delete", { target: slug, details: { name } });
  }

  async get(slug: string, actor?: Actor): Promise<Project> {
    const project = await this.prisma.project.findUnique({ where: { slug } });
    if (!project) {
      throw new NotFoundException(`project "${slug}" not found`);
    }
    if (actor) {
      assertInProject(actor, project.id);
    }
    return project;
  }

  async create(actor: Actor, input: ProjectInput) {
    const issue = slugIssue("project", input.slug, "slug");
    if (issue) {
      throw new BadRequestException(issue.hint ? `${issue.message} (${issue.hint})` : issue.message);
    }
    const data = this.validate({ name: input.name ?? input.slug, ...input }, true);
    try {
      const project = await this.prisma.project.create({ data: { slug: input.slug as string, ...data } as Prisma.ProjectCreateInput });
      await this.audit.record(actor, "project.create", { target: project.slug, details: { repoUrl: project.repoUrl } });
      return project;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(`project "${input.slug}" already exists`);
      }
      throw error;
    }
  }

  async update(actor: Actor, slug: string, input: ProjectInput) {
    await this.get(slug);
    const project = await this.prisma.project.update({ where: { slug }, data: this.validate(input, false) });
    await this.audit.record(actor, "project.update", { target: slug, details: { ...input } });
    return project;
  }

  async remove(actor: Actor, slug: string) {
    const project = await this.get(slug);
    const live = await this.prisma.environment.count({ where: { projectId: project.id, deletedAt: null } });
    if (live > 0) {
      throw new ConflictException(`project "${slug}" still has ${live} environment(s); delete them first`);
    }
    await this.prisma.$transaction([
      this.prisma.environment.deleteMany({ where: { projectId: project.id } }),
      this.prisma.project.delete({ where: { slug } }),
    ]);
    await this.audit.record(actor, "project.delete", { target: slug });
  }

  private validate(input: ProjectInput, creating: boolean): Prisma.ProjectUpdateInput {
    const data: Prisma.ProjectUpdateInput = {};
    if (input.name !== undefined) {
      if (typeof input.name !== "string" || input.name.trim().length === 0) {
        throw new BadRequestException("name must be a non-empty string");
      }
      data.name = input.name.trim();
    }
    if (input.repoUrl !== undefined || creating) {
      try {
        data.repoUrl = this.git.validateRepoUrl(input.repoUrl ?? "");
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
    }
    if (input.defaultRef !== undefined) {
      try {
        data.defaultRef = sanitizeGitBranch(input.defaultRef);
      } catch (error) {
        throw new BadRequestException(`defaultRef: ${(error as Error).message}`);
      }
    }
    if (input.allowPublic !== undefined) {
      if (typeof input.allowPublic !== "boolean") {
        throw new BadRequestException("allowPublic must be true or false");
      }
      data.allowPublic = input.allowPublic;
    }
    if (input.allowAlwaysOn !== undefined) {
      if (typeof input.allowAlwaysOn !== "boolean") {
        throw new BadRequestException("allowAlwaysOn must be true or false");
      }
      data.allowAlwaysOn = input.allowAlwaysOn;
    }
    if (input.rootDir !== undefined) {
      const rootDir = path.posix.normalize(input.rootDir || ".");
      if (path.posix.isAbsolute(rootDir) || rootDir === ".." || rootDir.startsWith("../")) {
        throw new BadRequestException("rootDir must be a path inside the repository");
      }
      data.rootDir = rootDir;
    }
    return data;
  }
}
