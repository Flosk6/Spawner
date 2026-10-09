import { BadRequestException } from "@nestjs/common";
import { sanitizeGitRepo } from "@spawner/utils";
import { beforeEach, describe, expect, it } from "vitest";
import { sessionActor } from "../../common/actor";
import type { PrismaService } from "../../common/prisma.service";
import type { SecretsService } from "../../common/secrets.service";
import type { AuditService } from "../audit/audit.service";
import type { GitMirrorService } from "../engine/git-mirror.service";
import { ProjectsService } from "./projects.service";

const MANIFEST = `version: 1
project: blog
sources:
  front:
    repo: git@github.com:acme/blog-front.git
  secrets:
    repo: git@github.com:acme/secrets.git
exposures:
  - { name: web, service: front, port: 3000 }
`;

describe("ProjectsService", () => {
  const admin = sessionActor({ id: 1, name: "Ada", role: "admin" });
  let project: { id: string; slug: string; repoUrl: string; defaultRef: string; rootDir: string; sourceRepos: string[] };
  let listed: string[];
  let service: ProjectsService;

  beforeEach(() => {
    project = { id: "p1", slug: "blog", repoUrl: "git@github.com:acme/blog.git", defaultRef: "main", rootDir: ".", sourceRepos: ["git@github.com:acme/blog-front.git"] };
    listed = [];
    const prisma = {
      project: {
        findUnique: async () => project,
        update: async ({ data }: { data: object }) => Object.assign(project, data),
      },
    };
    const git = {
      validateRepoUrl: (url: string) => sanitizeGitRepo(url),
      readFile: async () => MANIFEST,
      listBranches: async (repo: string) => {
        listed.push(repo);
        return ["main"];
      },
    };
    service = new ProjectsService(prisma as unknown as PrismaService, git as unknown as GitMirrorService, { record: async () => undefined } as unknown as AuditService, {} as SecretsService);
  });

  it("keeps the source repositories an admin lists: valid URLs, each once", async () => {
    await service.update(admin, "blog", { sourceRepos: [" git@github.com:acme/blog-front.git", "https://github.com/acme/docs.git", "git@github.com:acme/blog-front.git", ""] });
    expect(project.sourceRepos).toEqual(["git@github.com:acme/blog-front.git", "https://github.com/acme/docs.git"]);

    await expect(service.update(admin, "blog", { sourceRepos: ["file:///etc/passwd"] })).rejects.toThrow(/sourceRepos: Invalid git repository format/);
    await expect(service.update(admin, "blog", { sourceRepos: "git@github.com:acme/front.git" })).rejects.toBeInstanceOf(BadRequestException);
    const many = Array.from({ length: 21 }, (_, index) => `git@github.com:acme/r${index}.git`);
    await expect(service.update(admin, "blog", { sourceRepos: many })).rejects.toThrow("20 source repositories at most");
  });

  it("lists the branches of a source only from a repository the project allows", async () => {
    expect(await service.branches("blog", admin, "front")).toEqual(["main"]);
    await expect(service.branches("blog", admin, "secrets")).rejects.toThrow(/git@github.com:acme\/secrets.git, which is not among the source repositories/);
    expect(listed).toEqual(["git@github.com:acme/blog-front.git"]);
  });

  it("names the sources the project does not allow among the issues of spawner.yaml", async () => {
    const { issues } = await service.manifest("blog", admin);
    expect(issues).toEqual([expect.objectContaining({ code: "manifest.source_repo", path: "sources.secrets.repo" })]);
  });
});
