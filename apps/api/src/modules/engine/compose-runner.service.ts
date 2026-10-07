import { Injectable } from "@nestjs/common";
import * as fs from "fs";
import { DockerService } from "../../common/docker.service";
import { baseEnv, run } from "./process";
import { SpawnerConfig } from "../../common/spawner.config";
import { StorageService } from "./storage.service";

/**
 * Runs `docker compose` on rendered files. Commands get an argument array
 * and a minimal environment (PATH, HOME, DOCKER_HOST): the rendered file has
 * every "$" escaped and nothing of Spawner's environment can leak into it.
 */
@Injectable()
export class ComposeRunner {
  constructor(
    private readonly config: SpawnerConfig,
    private readonly storage: StorageService,
    private readonly docker: DockerService,
  ) {}

  /**
   * Builds and starts an environment, then waits until every service is
   * running and every healthcheck passes.
   */
  async up(project: string, file: string, onLine: (line: string) => void): Promise<void> {
    await this.compose(
      ["-p", project, "-f", file, "up", "-d", "--build", "--remove-orphans", "--wait", "--wait-timeout", String(this.config.startTimeoutSeconds)],
      onLine,
    );
  }

  /**
   * Recreates services whose configuration did not change, so that those
   * mounting a source see the directory the update put in place of the old
   * one.
   */
  async recreate(project: string, file: string, services: string[], onLine: (line: string) => void): Promise<void> {
    await this.compose(
      [
        "-p",
        project,
        "-f",
        file,
        "up",
        "-d",
        "--no-deps",
        "--force-recreate",
        "--wait",
        "--wait-timeout",
        String(this.config.startTimeoutSeconds),
        "--",
        ...services,
      ],
      onLine,
    );
  }

  async stop(project: string, file: string, onLine: (line: string) => void): Promise<void> {
    await this.compose(["-p", project, "-f", file, "stop"], onLine);
  }

  async start(project: string, file: string, onLine: (line: string) => void): Promise<void> {
    await this.compose(["-p", project, "-f", file, "start", "--wait", "--wait-timeout", String(this.config.startTimeoutSeconds)], onLine);
  }

  /**
   * Creates and starts the containers of an environment from the images
   * already built, without its sources.
   */
  async upWithoutBuild(project: string, file: string, onLine: (line: string) => void): Promise<void> {
    await this.compose(["-p", project, "-f", file, "up", "-d", "--no-build", "--wait", "--wait-timeout", String(this.config.startTimeoutSeconds)], onLine);
  }

  /**
   * Removes the containers, volumes and network of an environment, then the
   * images Compose built for it.
   */
  async down(project: string, file: string, onLine: (line: string) => void): Promise<void> {
    const fileArgs = fs.existsSync(file) ? ["-f", file] : [];
    await this.compose(["-p", project, ...fileArgs, "down", "--volumes", "--remove-orphans"], onLine);
    await this.removeImages(project, onLine);
  }

  private async removeImages(project: string, onLine: (line: string) => void): Promise<void> {
    const images = await this.docker.client.listImages({ filters: { label: [`com.docker.compose.project=${project}`] } });
    for (const image of images) {
      try {
        await this.docker.client.getImage(image.Id).remove();
        onLine(`Removed image ${image.RepoTags?.[0] ?? image.Id.slice(7, 19)}`);
      } catch (error) {
        onLine(`Kept image ${image.Id.slice(7, 19)}: ${(error as Error).message}`);
      }
    }
  }

  private async compose(args: string[], onLine: (line: string) => void): Promise<void> {
    await run("docker", ["compose", ...args], {
      cwd: this.storage.homeDir,
      env: {
        ...baseEnv(this.storage.homeDir),
        DOCKER_HOST: `unix://${this.config.dockerSocket}`,
        COMPOSE_ANSI: "never",
        COMPOSE_PROGRESS: "plain",
        BUILDKIT_PROGRESS: "plain",
        DOCKER_CLI_HINTS: "false",
      },
      timeoutMs: this.config.jobTimeoutSeconds * 1000,
      onLine,
    });
  }
}
