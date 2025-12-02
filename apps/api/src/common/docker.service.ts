import { Injectable, OnModuleInit } from "@nestjs/common";
import Docker from "dockerode";
import * as stream from "stream";

export interface ContainerConfig {
  name: string;
  image?: string;
  buildContext?: string;
  environment?: Record<string, string>;
  labels?: Record<string, string>;
  networks?: string[];
  volumes?: string[];
  ports?: string[];
  dependsOn?: string[];
  extraHosts?: string[];
  resourceLimits?: {
    cpus: string;
    memory: string;
    cpuReservation?: string;
    memoryReservation?: string;
  };
}

@Injectable()
export class DockerService implements OnModuleInit {
  private docker: Docker;

  onModuleInit() {
    const socketPath = process.env.DOCKER_SOCKET || "/var/run/docker.sock";
    this.docker = new Docker({ socketPath });
  }

  async createNetwork(name: string): Promise<Docker.Network> {
    try {
      const existingNetworks = await this.docker.listNetworks({
        filters: { name: [name] },
      });

      if (existingNetworks.length > 0) {
        return this.docker.getNetwork(existingNetworks[0].Id);
      }

      return await this.docker.createNetwork({
        Name: name,
        Driver: "bridge",
      });
    } catch (error) {
      throw new Error(`Failed to create network ${name}: ${error.message}`);
    }
  }

  async removeNetwork(name: string): Promise<void> {
    try {
      const networks = await this.docker.listNetworks({
        filters: { name: [name] },
      });

      for (const networkInfo of networks) {
        const network = this.docker.getNetwork(networkInfo.Id);
        await network.remove();
      }
    } catch (error) {
      console.error(`Failed to remove network ${name}:`, error.message);
    }
  }

  async createVolume(name: string): Promise<void> {
    try {
      const existingVolumes = await this.docker.listVolumes({
        filters: { name: [name] },
      });

      if (existingVolumes.Volumes && existingVolumes.Volumes.length > 0) {
        console.warn(
          `Volume ${name} already exists. Deleting it to create a fresh one...`
        );
        try {
          await this.removeVolume(name);
        } catch (error) {
          console.error(
            `Failed to remove existing volume ${name}:`,
            error.message
          );
          throw new Error(
            `Cannot create volume ${name}: old volume exists and couldn't be removed`
          );
        }
      }

      await this.docker.createVolume({ Name: name });
      console.log(`Volume ${name} created successfully`);
    } catch (error) {
      throw new Error(`Failed to create volume ${name}: ${error.message}`);
    }
  }

  async removeVolume(name: string): Promise<void> {
    try {
      const volume = this.docker.getVolume(name);
      await volume.remove({ force: true });
    } catch (error) {
      if (error.statusCode === 404) {
        console.log(`Volume ${name} does not exist, skipping...`);
        return;
      }
      console.error(`Failed to remove volume ${name}:`, error.message);
      throw error;
    }
  }

  async removeImage(tag: string): Promise<void> {
    try {
      const image = this.docker.getImage(tag);
      await image.remove({ force: true });
    } catch (error) {
      console.error(`Failed to remove image ${tag}:`, error.message);
    }
  }

  async buildImage(
    buildContext: string,
    tag: string,
    onProgress?: (message: string) => void,
    dockerfilePath?: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const buildOptions: any = {
        context: buildContext,
        src: ["."],
      };

      if (dockerfilePath) {
        buildOptions.src.push(dockerfilePath);
      }

      this.docker.buildImage(
        buildOptions,
        dockerfilePath ? { t: tag, dockerfile: dockerfilePath } : { t: tag },
        (err, stream) => {
          if (err) {
            reject(new Error(`Failed to build image ${tag}: ${err.message}`));
            return;
          }

          this.docker.modem.followProgress(
            stream,
            async (err) => {
              if (err) {
                reject(new Error(`Build failed for ${tag}: ${err.message}`));
              } else {
                const imageExists = await this.imageExists(tag);
                if (!imageExists) {
                  reject(
                    new Error(
                      `Build completed but image ${tag} was not created`
                    )
                  );
                } else {
                  resolve();
                }
              }
            },
            (event) => {
              if (event.stream) {
                const message = event.stream.trim();
                if (message) {
                  if (onProgress) {
                    onProgress(message);
                  } else {
                    process.stdout.write(event.stream);
                  }
                }
              }
            }
          );
        }
      );
    });
  }

  async imageExists(tag: string): Promise<boolean> {
    try {
      const image = this.docker.getImage(tag);
      await image.inspect();
      return true;
    } catch (error) {
      return false;
    }
  }

  async pullImage(
    imageName: string,
    onProgress?: (message: string) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.pull(imageName, (err, stream) => {
        if (err) {
          reject(new Error(`Failed to pull image ${imageName}: ${err.message}`));
          return;
        }

        this.docker.modem.followProgress(
          stream,
          (err) => {
            if (err) {
              reject(new Error(`Pull failed for ${imageName}: ${err.message}`));
            } else {
              resolve();
            }
          },
          (event) => {
            if (event.status && onProgress) {
              const message = event.status + (event.progress || "");
              onProgress(message);
            }
          }
        );
      });
    });
  }

  async ensureImage(
    imageName: string,
    onProgress?: (message: string) => void
  ): Promise<void> {
    const exists = await this.imageExists(imageName);
    if (!exists) {
      if (onProgress) {
        onProgress(`Image ${imageName} not found, pulling...`);
      }
      await this.pullImage(imageName, onProgress);
    }
  }

  async createContainer(config: ContainerConfig): Promise<Docker.Container> {
    try {
      const cpuLimit = this.parseCpuLimit(config.resourceLimits?.cpus || "2");
      const memoryLimit = this.parseMemoryLimit(
        config.resourceLimits?.memory || "1G"
      );
      const memoryReservation = config.resourceLimits?.memoryReservation
        ? this.parseMemoryLimit(config.resourceLimits.memoryReservation)
        : undefined;

      const createOptions: any = {
        name: config.name,
        Image: config.image,
        Env: config.environment
          ? Object.entries(config.environment).map(
              ([key, value]) => `${key}=${value}`
            )
          : [],
        Labels: config.labels || {},
        HostConfig: {
          NetworkMode: config.networks?.[0] || "bridge",
          Binds: config.volumes || [],
          PortBindings: this.parsePortBindings(config.ports || []),
          NanoCPUs: cpuLimit,
          Memory: memoryLimit,
          ExtraHosts: config.extraHosts || [],
        },
      };

      if (memoryReservation) {
        createOptions.HostConfig.MemoryReservation = memoryReservation;
      }

      const container = await this.docker.createContainer(createOptions);

      if (config.networks && config.networks.length > 1) {
        for (let i = 1; i < config.networks.length; i++) {
          await this.connectContainerToNetwork(config.name, config.networks[i]);
        }
      }

      return container;
    } catch (error) {
      throw new Error(
        `Failed to create container ${config.name}: ${error.message}`
      );
    }
  }

  async startContainer(containerNameOrId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerNameOrId);
      await container.start();
    } catch (error) {
      if (error.statusCode === 304) {
        return;
      }
      throw new Error(
        `Failed to start container ${containerNameOrId}: ${error.message}`
      );
    }
  }

  async stopContainer(
    containerNameOrId: string,
    timeout: number = 10
  ): Promise<void> {
    try {
      const container = this.docker.getContainer(containerNameOrId);
      await container.stop({ t: timeout });
    } catch (error) {
      if (error.statusCode === 304 || error.statusCode === 404) {
        return;
      }
      throw new Error(
        `Failed to stop container ${containerNameOrId}: ${error.message}`
      );
    }
  }

  async restartContainer(
    containerNameOrId: string,
    timeout: number = 10
  ): Promise<void> {
    try {
      const container = this.docker.getContainer(containerNameOrId);
      await container.restart({ t: timeout });
    } catch (error) {
      if (error.statusCode === 404) {
        throw new Error(
          `Container ${containerNameOrId} not found. It may have been removed.`
        );
      }
      throw new Error(
        `Failed to restart container ${containerNameOrId}: ${error.message}`
      );
    }
  }

  async removeContainer(
    containerNameOrId: string,
    force: boolean = false
  ): Promise<void> {
    try {
      const container = this.docker.getContainer(containerNameOrId);
      await container.remove({ force, v: true });
    } catch (error) {
      if (error.statusCode === 404) {
        return;
      }
      throw new Error(
        `Failed to remove container ${containerNameOrId}: ${error.message}`
      );
    }
  }

  async getContainerLogs(
    containerNameOrId: string,
    tail: number = 500
  ): Promise<string> {
    try {
      const container = this.docker.getContainer(containerNameOrId);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail,
        timestamps: true,
      });

      return logs.toString("utf-8");
    } catch (error) {
      throw new Error(
        `Failed to get logs for ${containerNameOrId}: ${error.message}`
      );
    }
  }

  async execInContainer(
    containerNameOrId: string,
    command: string[],
    timeout: number = 30000
  ): Promise<{ output: string; exitCode: number }> {
    return new Promise(async (resolve, reject) => {
      try {
        const container = this.docker.getContainer(containerNameOrId);

        const exec = await container.exec({
          Cmd: command,
          AttachStdout: true,
          AttachStderr: true,
        });

        const execStream = await exec.start({ hijack: true, stdin: false });

        let output = "";
        const outputStream = new stream.Writable({
          write(chunk, encoding, callback) {
            output += chunk.toString("utf-8");
            callback();
          },
        });

        this.docker.modem.demuxStream(execStream, outputStream, outputStream);

        const timeoutHandle = setTimeout(() => {
          reject(new Error("Command execution timeout"));
        }, timeout);

        execStream.on("end", async () => {
          clearTimeout(timeoutHandle);
          const inspectData = await exec.inspect();
          resolve({
            output: output.trim(),
            exitCode: inspectData.ExitCode || 0,
          });
        });

        execStream.on("error", (err) => {
          clearTimeout(timeoutHandle);
          reject(err);
        });
      } catch (error) {
        reject(
          new Error(
            `Failed to execute command in ${containerNameOrId}: ${error.message}`
          )
        );
      }
    });
  }

  async listContainers(projectName: string): Promise<Docker.ContainerInfo[]> {
    try {
      return await this.docker.listContainers({
        all: true,
        filters: {
          label: [`com.docker.compose.project=${projectName}`],
        },
      });
    } catch (error) {
      throw new Error(
        `Failed to list containers for project ${projectName}: ${error.message}`
      );
    }
  }

  async connectContainerToNetwork(
    containerNameOrId: string,
    networkName: string
  ): Promise<void> {
    try {
      const network = this.docker.getNetwork(networkName);
      await network.connect({ Container: containerNameOrId });
    } catch (error) {
      throw new Error(
        `Failed to connect ${containerNameOrId} to ${networkName}: ${error.message}`
      );
    }
  }

  private parseCpuLimit(cpuString: string): number {
    const cpu = parseFloat(cpuString);
    return cpu * 1e9;
  }

  private parseMemoryLimit(memoryString: string): number {
    const units: Record<string, number> = {
      k: 1024,
      m: 1024 * 1024,
      g: 1024 * 1024 * 1024,
    };

    const match = memoryString.toLowerCase().match(/^(\d+)([kmg])?$/);
    if (!match) {
      throw new Error(`Invalid memory format: ${memoryString}`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2] || "";

    return value * (units[unit] || 1);
  }

  private parsePortBindings(ports: string[]): Record<string, any[]> {
    const bindings: Record<string, any[]> = {};

    for (const port of ports) {
      const [hostPort, containerPort] = port.split(":");
      const containerKey = containerPort.includes("/")
        ? containerPort
        : `${containerPort}/tcp`;

      bindings[containerKey] = [{ HostPort: hostPort }];
    }

    return bindings;
  }

  async getContainerByName(name: string): Promise<Docker.ContainerInfo | null> {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: { name: [name] },
      });

      return containers.length > 0 ? containers[0] : null;
    } catch (error) {
      console.error(`Failed to get container by name ${name}:`, error.message);
      return null;
    }
  }

  async waitForDependencies(
    containerNames: string[],
    timeout: number = 60000
  ): Promise<void> {
    const startTime = Date.now();

    for (const name of containerNames) {
      while (Date.now() - startTime < timeout) {
        try {
          const containerInfo = await this.getContainerByName(name);
          if (containerInfo && containerInfo.State === "running") {
            break;
          }
        } catch (error) {
          console.error(`Error checking dependency ${name}:`, error.message);
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  async getSystemDiskUsage(): Promise<any> {
    try {
      return await this.docker.df();
    } catch (error) {
      throw new Error(`Failed to get disk usage: ${error.message}`);
    }
  }

  async pruneImages(dangling: boolean = true): Promise<any> {
    try {
      const filters: any = {};
      if (dangling) {
        filters.dangling = { true: true };
      }
      return await this.docker.pruneImages({ filters });
    } catch (error) {
      throw new Error(`Failed to prune images: ${error.message}`);
    }
  }

  async pruneBuildCache(): Promise<any> {
    try {
      const buildPruneUrl = "/build/prune";
      return await new Promise((resolve, reject) => {
        this.docker.modem.dial(
          {
            path: buildPruneUrl,
            method: "POST",
            statusCodes: {
              200: true,
              204: true,
              500: "server error",
            },
          },
          (err, data) => {
            if (err) {
              reject(new Error(`Failed to prune build cache: ${err.message}`));
            } else {
              resolve(data);
            }
          }
        );
      });
    } catch (error) {
      throw new Error(`Failed to prune build cache: ${error.message}`);
    }
  }

  async pruneVolumes(): Promise<any> {
    try {
      return await this.docker.pruneVolumes();
    } catch (error) {
      throw new Error(`Failed to prune volumes: ${error.message}`);
    }
  }

  async pruneContainers(): Promise<any> {
    try {
      return await this.docker.pruneContainers();
    } catch (error) {
      throw new Error(`Failed to prune containers: ${error.message}`);
    }
  }

  async pruneNetworks(): Promise<any> {
    try {
      return await this.docker.pruneNetworks();
    } catch (error) {
      throw new Error(`Failed to prune networks: ${error.message}`);
    }
  }

  async listAllImages(): Promise<any[]> {
    try {
      const images = await this.docker.listImages({ all: true });
      const containers = await this.docker.listContainers({ all: true });

      return images.map((image) => {
        const usedByContainers = containers.filter(
          (c) => c.ImageID === image.Id || c.Image === image.RepoTags?.[0]
        );

        const isDangling =
          !image.RepoTags ||
          image.RepoTags.length === 0 ||
          image.RepoTags.includes("<none>:<none>");

        const ageInDays = Math.floor(
          (Date.now() - image.Created * 1000) / (1000 * 60 * 60 * 24)
        );

        let recommendation = "unknown";
        if (isDangling) {
          recommendation = "safe";
        } else if (usedByContainers.length === 0 && ageInDays > 30) {
          recommendation = "safe";
        } else if (usedByContainers.length === 0 && ageInDays > 7) {
          recommendation = "probably-safe";
        } else if (usedByContainers.length > 0) {
          recommendation = "in-use";
        }

        return {
          ...image,
          isDangling,
          usedByContainers: usedByContainers.map((c) => ({
            id: c.Id,
            name: c.Names?.[0]?.replace(/^\//, "") || c.Id.substring(0, 12),
            state: c.State,
          })),
          ageInDays,
          createdAt: new Date(image.Created * 1000).toISOString(),
          recommendation,
        };
      });
    } catch (error) {
      throw new Error(`Failed to list images: ${error.message}`);
    }
  }

  async listAllContainers(): Promise<any[]> {
    try {
      const containers = await this.docker.listContainers({ all: true, size: true });

      return containers.map((container) => {
        const createdAt = new Date(container.Created * 1000);
        const ageInDays = Math.floor(
          (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
        );

        const isStopped = container.State !== "running";
        const isSpawnerContainer = container.Names?.some((name) =>
          name.includes("env-")
        );

        let recommendation = "unknown";
        if (isStopped && ageInDays > 7) {
          recommendation = "safe";
        } else if (isStopped && ageInDays > 1) {
          recommendation = "probably-safe";
        } else if (container.State === "running") {
          recommendation = "in-use";
        }

        const environmentName = isSpawnerContainer
          ? this.extractEnvironmentName(container.Names?.[0])
          : null;

        return {
          ...container,
          ageInDays,
          createdAt: createdAt.toISOString(),
          isStopped,
          isSpawnerContainer,
          environmentName,
          recommendation,
        };
      });
    } catch (error) {
      throw new Error(`Failed to list containers: ${error.message}`);
    }
  }

  private extractEnvironmentName(containerName: string): string | null {
    if (!containerName) return null;
    const match = containerName.match(/^\/env-([^-]+)-([^-]+)-/);
    if (match) {
      return `${match[1]}-${match[2]}`;
    }
    return null;
  }

  async listAllVolumes(): Promise<any> {
    try {
      return await this.docker.listVolumes();
    } catch (error) {
      throw new Error(`Failed to list volumes: ${error.message}`);
    }
  }

  async listAllNetworks(): Promise<any[]> {
    try {
      return await this.docker.listNetworks();
    } catch (error) {
      throw new Error(`Failed to list networks: ${error.message}`);
    }
  }

  async removeImageById(imageId: string, force: boolean = false): Promise<void> {
    try {
      const image = this.docker.getImage(imageId);
      await image.remove({ force });
    } catch (error) {
      if (error.statusCode === 409) {
        throw new Error(`Cannot remove image (has dependent child images). Try removing child images first, or use force option.`);
      } else if (error.statusCode === 404) {
        throw new Error(`Image not found (may have been already deleted)`);
      }
      throw new Error(`Failed to remove image ${imageId}: ${error.message}`);
    }
  }

  async removeVolumeByName(volumeName: string): Promise<void> {
    try {
      const volume = this.docker.getVolume(volumeName);
      await volume.remove();
    } catch (error) {
      throw new Error(`Failed to remove volume ${volumeName}: ${error.message}`);
    }
  }

  async removeNetworkById(networkId: string): Promise<void> {
    try {
      const network = this.docker.getNetwork(networkId);
      await network.remove();
    } catch (error) {
      throw new Error(`Failed to remove network ${networkId}: ${error.message}`);
    }
  }

  async intelligentCleanup(options?: {
    imageDaysThreshold?: number;
    containerDaysThreshold?: number;
    cacheDaysThreshold?: number;
  }): Promise<{
    images: { removed: number; spaceFreed: number; ids: string[] };
    containers: { removed: number; ids: string[] };
    cache: { spaceFreed: number };
    volumes: { removed: number; names: string[] };
  }> {
    const imageDaysThreshold = options?.imageDaysThreshold || 30;
    const containerDaysThreshold = options?.containerDaysThreshold || 7;

    const result = {
      images: { removed: 0, spaceFreed: 0, ids: [] as string[] },
      containers: { removed: 0, ids: [] as string[] },
      cache: { spaceFreed: 0 },
      volumes: { removed: 0, names: [] as string[] },
    };

    try {
      const images = await this.listAllImages();
      const containers = await this.listAllContainers();

      for (const container of containers) {
        if (container.isStopped && container.ageInDays > containerDaysThreshold) {
          try {
            await this.removeContainer(container.Id, true);
            result.containers.removed++;
            result.containers.ids.push(container.Id);
          } catch (error) {
            console.error(
              `Failed to remove container ${container.Id}:`,
              error.message
            );
          }
        }
      }

      for (const image of images) {
        if (
          image.isDangling ||
          (image.usedByContainers.length === 0 && image.ageInDays > imageDaysThreshold)
        ) {
          try {
            await this.removeImageById(image.Id);
            result.images.removed++;
            result.images.spaceFreed += image.Size || 0;
            result.images.ids.push(image.Id);
          } catch (error) {
            console.error(`Failed to remove image ${image.Id}:`, error.message);
          }
        }
      }

      try {
        const cacheResult = await this.pruneBuildCache();
        result.cache.spaceFreed = cacheResult?.SpaceReclaimed || 0;
      } catch (error) {
        console.error("Failed to prune cache:", error.message);
      }

      return result;
    } catch (error) {
      throw new Error(`Intelligent cleanup failed: ${error.message}`);
    }
  }

  async getContainerStats(containerName: string): Promise<{
    cpuPercent: number;
    memoryUsage: number;
    memoryLimit: number;
    memoryPercent: number;
  } | null> {
    try {
      const container = this.docker.getContainer(containerName);
      const stats = await container.stats({ stream: false });

      const cpuDelta =
        stats.cpu_stats.cpu_usage.total_usage -
        stats.precpu_stats.cpu_usage.total_usage;
      const systemDelta =
        stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
      const cpuPercent =
        systemDelta > 0
          ? (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100
          : 0;

      const memoryUsage = stats.memory_stats.usage || 0;
      const memoryLimit = stats.memory_stats.limit || 0;
      const memoryPercent =
        memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0;

      return {
        cpuPercent: Math.round(cpuPercent * 10) / 10,
        memoryUsage,
        memoryLimit,
        memoryPercent: Math.round(memoryPercent * 10) / 10,
      };
    } catch (error) {
      console.error(
        `Failed to get stats for container ${containerName}:`,
        error.message
      );
      return null;
    }
  }

  async getEnvironmentStats(
    environmentName: string
  ): Promise<{
    totalCpu: number;
    totalMemoryUsage: number;
    totalMemoryLimit: number;
    containers: Array<{
      name: string;
      cpuPercent: number;
      memoryUsage: number;
      memoryLimit: number;
    }>;
  }> {
    try {
      const containerSuffix = `-${environmentName}`;
      const allContainers = await this.docker.listContainers();
      const envContainers = allContainers.filter((c) =>
        c.Names.some((name) => name.endsWith(containerSuffix))
      );

      let totalCpu = 0;
      let totalMemoryUsage = 0;
      let totalMemoryLimit = 0;
      const containers: Array<{
        name: string;
        cpuPercent: number;
        memoryUsage: number;
        memoryLimit: number;
      }> = [];

      for (const containerInfo of envContainers) {
        const containerName = containerInfo.Names[0].replace("/", "");
        const stats = await this.getContainerStats(containerName);

        if (stats) {
          totalCpu += stats.cpuPercent;
          totalMemoryUsage += stats.memoryUsage;
          totalMemoryLimit += stats.memoryLimit;

          containers.push({
            name: containerName,
            cpuPercent: stats.cpuPercent,
            memoryUsage: stats.memoryUsage,
            memoryLimit: stats.memoryLimit,
          });
        }
      }

      return {
        totalCpu: Math.round(totalCpu * 10) / 10,
        totalMemoryUsage,
        totalMemoryLimit,
        containers,
      };
    } catch (error) {
      throw new Error(
        `Failed to get environment stats: ${error.message}`
      );
    }
  }
}
