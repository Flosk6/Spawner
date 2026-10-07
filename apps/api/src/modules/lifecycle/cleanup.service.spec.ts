import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import type { DockerService } from "../../common/docker.service";
import type { PrismaService } from "../../common/prisma.service";
import type { SpawnerConfig } from "../../common/spawner.config";
import type { GitMirrorService } from "../engine/git-mirror.service";
import type { StorageService } from "../engine/storage.service";
import { CleanupService } from "./cleanup.service";

const label = (env: string) => ({ "dev.spawner.env": env });

describe("CleanupService", () => {
  it("lists what deleted environments left, and only offers what it does not know", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-"));
    const dirs = { traefik: path.join(root, "traefik"), envs: path.join(root, "envs"), uploads: path.join(root, "uploads"), mirrors: path.join(root, "mirrors") };
    Object.values(dirs).forEach((dir) => fs.mkdirSync(dir));
    fs.writeFileSync(path.join(dirs.traefik, "_spawner.yaml"), "");
    fs.writeFileSync(path.join(dirs.traefik, "live.yaml"), "");
    fs.writeFileSync(path.join(dirs.traefik, "gone.yaml"), "");
    fs.mkdirSync(path.join(dirs.envs, "live"));
    fs.mkdirSync(path.join(dirs.envs, "gone"));
    const oldUpload = path.join(dirs.uploads, "old.tar.gz");
    fs.writeFileSync(oldUpload, "x");
    fs.utimesSync(oldUpload, new Date(Date.now() - 2 * 86_400_000), new Date(Date.now() - 2 * 86_400_000));
    fs.writeFileSync(path.join(dirs.uploads, "new.tar.gz"), "x");
    fs.mkdirSync(path.join(dirs.mirrors, "used"));
    fs.mkdirSync(path.join(dirs.mirrors, "unused"));

    const prisma = {
      environment: {
        findMany: async () => [
          { id: "live", slug: "feat-a", deletedAt: null, project: { slug: "blog" }, jobs: [] },
          { id: "gone", slug: "feat-b", deletedAt: new Date(), project: { slug: "blog" }, jobs: [] },
        ],
      },
      job: { findMany: async () => [] },
      project: { findMany: async () => [{ repoUrl: "https://example.com/used.git" }] },
      environmentSource: { findMany: async () => [] },
    };
    const docker = {
      client: {
        listContainers: async ({ filters }: { filters?: unknown } = {}) =>
          filters
            ? [
                { Id: "c-live", Names: ["/spn-blog--feat-a-app-1"], Labels: label("live"), ImageID: "img-live" },
                { Id: "c-gone", Names: ["/spn-blog--feat-b-app-1"], Labels: label("gone"), ImageID: "img-gone" },
                { Id: "c-other", Names: ["/other-app-1"], Labels: label("someone-else"), ImageID: "img-x" },
              ]
            : [{ ImageID: "img-live" }, { ImageID: "img-gone" }, { ImageID: "img-x" }],
        listVolumes: async () => ({ Volumes: [{ Name: "spn-blog--feat-b_data", Labels: label("gone") }, { Name: "spn-blog--feat-a_data", Labels: label("live") }] }),
        listNetworks: async () => [{ Id: "n-gone", Name: "spn-blog--feat-b_default", Labels: label("gone") }],
        listImages: async () => [
          { Id: "img-live", RepoTags: ["spn-blog--feat-a-app:latest"], Labels: label("live"), Size: 100 },
          { Id: "img-old", RepoTags: ["<none>:<none>"], Labels: label("live"), Size: 80 },
          { Id: "img-legacy", RepoTags: ["spn-blog--feat-b-app:latest"], Labels: { "com.docker.compose.project": "spn-blog--feat-b" }, Size: 90 },
          { Id: "img-foreign", RepoTags: ["postgres:18"], Labels: {}, Size: 300 },
        ],
      },
    };
    const storage = {
      traefikDir: dirs.traefik,
      envsDir: dirs.envs,
      uploadsDir: dirs.uploads,
      mirrorsDir: dirs.mirrors,
      mirrorDir: () => path.join(dirs.mirrors, "used"),
    };
    const cleanup = new CleanupService(
      prisma as unknown as PrismaService,
      docker as unknown as DockerService,
      { traefikContainer: "spawner-traefik" } as SpawnerConfig,
      storage as unknown as StorageService,
      {} as GitMirrorService,
    );

    const items = await cleanup.scan();
    const summary = items.map((item) => `${item.automatic ? "auto" : "manual"} ${item.kind} ${item.name}`).sort();
    expect(summary).toEqual([
      "auto container spn-blog--feat-b-app-1",
      "auto directory envs/gone",
      "auto image img-old",
      "auto image spn-blog--feat-b-app:latest",
      "auto network spn-blog--feat-b_default",
      "auto routes traefik/gone.yaml",
      "auto upload uploads/old.tar.gz",
      "auto volume spn-blog--feat-b_data",
      "manual container other-app-1",
      "manual mirror mirrors/unused",
    ]);
  });
});
