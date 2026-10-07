/** The part of `docker system df` the disk view reads. */
export interface DockerDiskUsage {
  LayersSize?: number;
  Images?: { Id: string; Size: number; SharedSize: number; Labels?: Record<string, string> | null }[] | null;
  Containers?: { Id: string; SizeRw?: number; Labels?: Record<string, string> | null }[] | null;
  Volumes?: { Name: string; Labels?: Record<string, string> | null; UsageData?: { Size: number } | null }[] | null;
  BuildCache?: { Size: number }[] | null;
}

/** What an environment holds on disk. */
export interface EnvironmentDisk {
  /** Layers of its built images no other image uses. */
  imagesUniqueBytes: number;
  /** Layers of its images other images share (dependencies, base images). */
  imagesSharedBytes: number;
  volumesBytes: number;
  /** Files its containers wrote outside volumes. */
  writableBytes: number;
  sourcesBytes: number;
  /** What the environment adds: everything but the shared layers. */
  totalBytes: number;
}

export interface DiskBreakdown {
  /** Every image layer, counted once. */
  imagesBytes: number;
  buildCacheBytes: number;
  volumesBytes: number;
  writableBytes: number;
  sourcesBytes: number;
  /** Job logs, archived logs and terminal recordings. */
  logsBytes: number;
  /** Spawner's own volumes (its database). */
  spawnerBytes: number;
  environments: Record<string, EnvironmentDisk>;
}

const LABEL_ENV = "dev.spawner.env";
const LABEL_PROJECT = "com.docker.compose.project";

/**
 * Splits Docker's disk usage between the environments: images by compose
 * project (Compose labels the images it builds), volumes and containers by
 * the dev.spawner.env label. Docker reports what an image shares with
 * others (SharedSize); the rest is the environment's own.
 *
 * @param environmentsByProject - Environment id of each compose project (spn-<project>--<env>)
 * @param sources - Size of the sources of each environment
 * @param ownProject - Compose project of Spawner's own containers
 */
export function attributeDisk(
  usage: DockerDiskUsage,
  input: { environmentsByProject: Map<string, string>; sources: Map<string, number>; ownProject: string | null; logsBytes: number },
): DiskBreakdown {
  const environments: Record<string, EnvironmentDisk> = {};
  const of = (id: string) =>
    (environments[id] ??= { imagesUniqueBytes: 0, imagesSharedBytes: 0, volumesBytes: 0, writableBytes: 0, sourcesBytes: input.sources.get(id) ?? 0, totalBytes: 0 });

  for (const image of usage.Images ?? []) {
    const environmentId = input.environmentsByProject.get(image.Labels?.[LABEL_PROJECT] ?? "");
    if (environmentId) {
      const shared = Math.max(image.SharedSize ?? 0, 0);
      of(environmentId).imagesUniqueBytes += Math.max(image.Size - shared, 0);
      of(environmentId).imagesSharedBytes += shared;
    }
  }
  let volumesBytes = 0;
  let spawnerBytes = 0;
  for (const volume of usage.Volumes ?? []) {
    const size = Math.max(volume.UsageData?.Size ?? 0, 0);
    volumesBytes += size;
    const environmentId = volume.Labels?.[LABEL_ENV] ?? input.environmentsByProject.get(volume.Labels?.[LABEL_PROJECT] ?? "");
    if (environmentId) {
      of(environmentId).volumesBytes += size;
    } else if (input.ownProject && volume.Labels?.[LABEL_PROJECT] === input.ownProject) {
      spawnerBytes += size;
    }
  }
  let writableBytes = 0;
  for (const container of usage.Containers ?? []) {
    const size = Math.max(container.SizeRw ?? 0, 0);
    writableBytes += size;
    const environmentId = container.Labels?.[LABEL_ENV];
    if (environmentId) {
      of(environmentId).writableBytes += size;
    }
  }
  for (const id of input.sources.keys()) {
    of(id);
  }
  for (const environment of Object.values(environments)) {
    environment.totalBytes = environment.imagesUniqueBytes + environment.volumesBytes + environment.writableBytes + environment.sourcesBytes;
  }

  return {
    imagesBytes: usage.LayersSize ?? (usage.Images ?? []).reduce((sum, image) => sum + image.Size, 0),
    buildCacheBytes: (usage.BuildCache ?? []).reduce((sum, entry) => sum + Math.max(entry.Size, 0), 0),
    volumesBytes,
    writableBytes,
    sourcesBytes: [...input.sources.values()].reduce((sum, size) => sum + size, 0),
    logsBytes: input.logsBytes,
    spawnerBytes,
    environments,
  };
}
