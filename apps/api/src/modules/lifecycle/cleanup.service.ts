import { Injectable, Logger } from "@nestjs/common";
import { composeProjectName } from "@spawner/core";
import * as fs from "fs";
import * as path from "path";
import { directorySize } from "../../common/directory-size";
import { DockerService } from "../../common/docker.service";
import { PrismaService } from "../../common/prisma.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { GitMirrorService } from "../engine/git-mirror.service";
import { StorageService } from "../engine/storage.service";

/** Uploads waiting this long without a job are left over. */
const UPLOAD_MAX_AGE_MS = 24 * 3600_000;
const ENV_LABEL = "dev.spawner.env";
const COMPOSE_PROJECT_LABEL = "com.docker.compose.project";

export type CleanupKind = "container" | "volume" | "network" | "image" | "routes" | "directory" | "upload" | "mirror";

/**
 * Something Spawner owns and no longer needs. Automatic items (left by a
 * deleted environment, or replaced) go every minute; the others wait for an
 * admin: resources labelled for environments this installation does not know
 * may belong to another installation on the same Docker host.
 */
export interface CleanupItem {
  kind: CleanupKind;
  /** Docker id or name, or path in the data directory. */
  id: string;
  name: string;
  sizeBytes: number | null;
  reason: string;
  automatic: boolean;
}

/**
 * Targeted cleanup: only what carries Spawner's labels or lives in its data
 * directory. Spawner never runs a global docker prune.
 */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docker: DockerService,
    private readonly config: SpawnerConfig,
    private readonly storage: StorageService,
    private readonly git: GitMirrorService,
  ) {}

  /**
   * Lists what can go, without removing anything.
   */
  async scan(): Promise<CleanupItem[]> {
    const environments = await this.prisma.environment.findMany({
      select: { id: true, slug: true, deletedAt: true, project: { select: { slug: true } }, jobs: { where: { status: { in: ["queued", "running"] } }, select: { id: true } } },
    });
    const live = new Set(environments.filter((environment) => !environment.deletedAt).map((environment) => environment.id));
    const busy = new Set(environments.filter((environment) => environment.jobs.length > 0).map((environment) => environment.id));
    const deleted = new Map(
      environments
        .filter((environment) => environment.deletedAt)
        .map((environment) => [environment.id, `${environment.project.slug}/${environment.slug}`] as const),
    );
    const deletedProjects = new Map(
      environments
        .filter((environment) => environment.deletedAt)
        .map((environment) => [composeProjectName(environment.project.slug, environment.slug), `${environment.project.slug}/${environment.slug}`] as const),
    );
    const liveProjects = new Set(
      environments.filter((environment) => !environment.deletedAt).map((environment) => composeProjectName(environment.project.slug, environment.slug)),
    );

    const classify = (envId: string | undefined, composeProject?: string): { reason: string; automatic: boolean } | null => {
      if (envId && live.has(envId)) {
        return null;
      }
      if (envId && deleted.has(envId)) {
        return { reason: `left by ${deleted.get(envId)}, deleted`, automatic: true };
      }
      if (!envId && composeProject && deletedProjects.has(composeProject)) {
        return { reason: `left by ${deletedProjects.get(composeProject)}, deleted`, automatic: true };
      }
      if (!envId && composeProject && liveProjects.has(composeProject)) {
        return null;
      }
      return { reason: "labelled for an environment this Spawner does not know (another installation, or a purged one)", automatic: false };
    };

    const items: CleanupItem[] = [];
    const client = this.docker.client;
    const [containers, volumes, networks, images] = await Promise.all([
      client.listContainers({ all: true, filters: { label: [ENV_LABEL] } }),
      client.listVolumes({ filters: { label: [ENV_LABEL] } }),
      client.listNetworks({ filters: { label: [ENV_LABEL] } }),
      client.listImages({ all: false }),
    ]);

    for (const container of containers) {
      const verdict = classify(container.Labels[ENV_LABEL]);
      if (verdict) {
        items.push({ kind: "container", id: container.Id, name: container.Names[0]?.replace(/^\//, "") ?? container.Id.slice(0, 12), sizeBytes: null, ...verdict });
      }
    }
    for (const volume of volumes.Volumes ?? []) {
      const verdict = classify(volume.Labels?.[ENV_LABEL]);
      if (verdict) {
        items.push({ kind: "volume", id: volume.Name, name: volume.Name, sizeBytes: null, ...verdict });
      }
    }
    for (const network of networks) {
      const verdict = classify(network.Labels?.[ENV_LABEL]);
      if (verdict) {
        items.push({ kind: "network", id: network.Id, name: network.Name, sizeBytes: null, ...verdict });
      }
    }
    const usedImages = new Set((await client.listContainers({ all: true })).map((container) => container.ImageID));
    for (const image of images) {
      const labels = image.Labels ?? {};
      const composeProject = labels[COMPOSE_PROJECT_LABEL];
      const envId = labels[ENV_LABEL];
      if (!envId && !composeProject?.startsWith("spn-")) {
        continue;
      }
      const name = image.RepoTags?.find((tag) => tag !== "<none>:<none>") ?? image.Id.replace(/^sha256:/, "").slice(0, 12);
      const verdict = classify(envId, composeProject);
      if (verdict) {
        items.push({ kind: "image", id: image.Id, name, sizeBytes: image.Size, ...verdict });
        continue;
      }
      const owner = envId ?? null;
      const dangling = !image.RepoTags || image.RepoTags.every((tag) => tag === "<none>:<none>");
      if (dangling && !usedImages.has(image.Id) && !(owner && busy.has(owner))) {
        items.push({ kind: "image", id: image.Id, name, sizeBytes: image.Size, reason: "a previous build, which no container runs", automatic: true });
      }
    }

    for (const file of this.list(this.storage.traefikDir)) {
      const id = file.replace(/\.yaml$/, "");
      if (file.endsWith(".yaml") && !file.startsWith("_") && !live.has(id)) {
        items.push({ kind: "routes", id: path.join(this.storage.traefikDir, file), name: `traefik/${file}`, sizeBytes: null, reason: "routes of an environment that no longer exists", automatic: true });
      }
    }
    for (const dir of this.list(this.storage.envsDir)) {
      if (!live.has(dir)) {
        const full = path.join(this.storage.envsDir, dir);
        items.push({ kind: "directory", id: full, name: `envs/${dir}`, sizeBytes: await directorySize(full), reason: "files of an environment that no longer exists", automatic: true });
      }
    }
    const waiting = await this.waitingUploads();
    for (const file of this.list(this.storage.uploadsDir)) {
      const full = path.join(this.storage.uploadsDir, file);
      const stat = fs.statSync(full, { throwIfNoEntry: false });
      if (stat && !waiting.has(full) && Date.now() - stat.mtimeMs > UPLOAD_MAX_AGE_MS) {
        items.push({ kind: "upload", id: full, name: `uploads/${file}`, sizeBytes: stat.size, reason: "an upload no job is waiting for", automatic: true });
      }
    }
    const usedMirrors = await this.usedMirrors();
    for (const dir of this.list(this.storage.mirrorsDir)) {
      const full = path.join(this.storage.mirrorsDir, dir);
      if (!usedMirrors.has(full)) {
        items.push({ kind: "mirror", id: full, name: `mirrors/${dir}`, sizeBytes: await directorySize(full), reason: "a repository no project or environment uses any more", automatic: false });
      }
    }
    return items;
  }

  /**
   * Removes what can go: the automatic items, or everything with all.
   *
   * @returns What was removed, and what could not be with the reason
   */
  async run(options: { all: boolean }): Promise<{ removed: CleanupItem[]; failed: (CleanupItem & { error: string })[] }> {
    const order: CleanupKind[] = ["container", "network", "volume", "image", "routes", "directory", "upload", "mirror"];
    const items = (await this.scan()).filter((item) => options.all || item.automatic).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    const removed: CleanupItem[] = [];
    const failed: (CleanupItem & { error: string })[] = [];
    for (const item of items) {
      try {
        await this.remove(item);
        removed.push(item);
      } catch (error) {
        failed.push({ ...item, error: (error as Error).message.split("\n")[0] });
      }
    }
    if (removed.length > 0) {
      this.logger.log(`Cleaned up ${removed.map((item) => `${item.kind} ${item.name}`).join(", ")}`);
    }
    return { removed, failed };
  }

  private async remove(item: CleanupItem): Promise<void> {
    const client = this.docker.client;
    switch (item.kind) {
      case "container":
        await client.getContainer(item.id).remove({ force: true, v: true });
        return;
      case "network":
        await this.docker.disconnectNetwork(item.id, this.config.traefikContainer).catch(() => undefined);
        await client.getNetwork(item.id).remove();
        return;
      case "volume":
        await client.getVolume(item.id).remove();
        return;
      case "image":
        await client.getImage(item.id).remove();
        return;
      case "routes":
      case "upload":
        fs.rmSync(item.id, { force: true });
        return;
      case "directory":
        await this.storage.removeTree(item.id);
        return;
      case "mirror":
        await this.git.removeMirror(item.id);
        return;
    }
  }

  private list(dir: string): string[] {
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  }

  /** Archives that queued or running jobs will still extract. */
  private async waitingUploads(): Promise<Set<string>> {
    const jobs = await this.prisma.job.findMany({ where: { status: { in: ["queued", "running"] }, type: { in: ["create", "update"] } }, select: { payload: true } });
    const archives = new Set<string>();
    for (const job of jobs) {
      const payload = job.payload as { primary?: { archive?: string }; sources?: Record<string, { archive?: string }> } | null;
      [payload?.primary, ...Object.values(payload?.sources ?? {})].forEach((request) => request?.archive && archives.add(request.archive));
    }
    return archives;
  }

  /** Mirrors of the repositories of the projects and of the live environments' sources. */
  private async usedMirrors(): Promise<Set<string>> {
    const [projects, sources] = await Promise.all([
      this.prisma.project.findMany({ select: { repoUrl: true } }),
      this.prisma.environmentSource.findMany({ where: { environment: { deletedAt: null }, repoUrl: { not: null } }, select: { repoUrl: true } }),
    ]);
    return new Set([...projects.map((project) => project.repoUrl), ...sources.map((source) => source.repoUrl as string)].map((url) => this.storage.mirrorDir(url)));
  }
}
