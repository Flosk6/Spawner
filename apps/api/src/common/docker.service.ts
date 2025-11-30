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
    onProgress?: (message: string) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.buildImage(
        {
          context: buildContext,
          src: ["."],
        },
        { t: tag },
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
}
