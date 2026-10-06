import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as path from "path";
import { slugIssue } from "@spawner/core";
import { sanitizeGitBranch } from "@spawner/utils";
import { PrismaService } from "../../common/prisma.service";
import { GitMirrorService } from "../engine/git-mirror.service";

export interface ProjectInput {
  slug?: string;
  name?: string;
  repoUrl?: string;
  defaultRef?: string;
  rootDir?: string;
}

/**
 * Projects: a repository holding .spawner/spawner.yaml (in rootDir, for
 * monorepos) and the branch environments start from by default.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly git: GitMirrorService,
  ) {}

  async list() {
    const projects = await this.prisma.project.findMany({
      orderBy: { slug: "asc" },
      include: { _count: { select: { environments: { where: { deletedAt: null } } } } },
    });
    return projects.map(({ _count, ...project }) => ({ ...project, environmentCount: _count.environments }));
  }

  async get(slug: string) {
    const project = await this.prisma.project.findUnique({ where: { slug } });
    if (!project) {
      throw new NotFoundException(`project "${slug}" not found`);
    }
    return project;
  }

  async create(input: ProjectInput) {
    const issue = slugIssue("project", input.slug, "slug");
    if (issue) {
      throw new BadRequestException(issue.hint ? `${issue.message} (${issue.hint})` : issue.message);
    }
    const data = this.validate({ name: input.name ?? input.slug, ...input }, true);
    try {
      return await this.prisma.project.create({ data: { slug: input.slug as string, ...data } as Prisma.ProjectCreateInput });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(`project "${input.slug}" already exists`);
      }
      throw error;
    }
  }

  async update(slug: string, input: ProjectInput) {
    await this.get(slug);
    return this.prisma.project.update({ where: { slug }, data: this.validate(input, false) });
  }

  async remove(slug: string) {
    const project = await this.get(slug);
    const live = await this.prisma.environment.count({ where: { projectId: project.id, deletedAt: null } });
    if (live > 0) {
      throw new ConflictException(`project "${slug}" still has ${live} environment(s); delete them first`);
    }
    await this.prisma.$transaction([
      this.prisma.environment.deleteMany({ where: { projectId: project.id } }),
      this.prisma.project.delete({ where: { slug } }),
    ]);
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
