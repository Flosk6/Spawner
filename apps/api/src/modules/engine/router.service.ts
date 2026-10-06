import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { stringify } from "yaml";
import { DockerService } from "../../common/docker.service";
import { SpawnerConfig } from "./spawner.config";
import { StorageService } from "./storage.service";

export interface RoutedExposure {
  name: string;
  service: string;
  port: number;
  host: string;
}

/**
 * Publishes environments through Traefik's file provider: one dynamic
 * configuration file per environment, so Traefik never needs the Docker
 * socket. Traefik joins each environment network while it is published and
 * leaves it afterwards; environments share no network with each other.
 */
@Injectable()
export class RouterService implements OnModuleInit {
  private readonly logger = new Logger(RouterService.name);

  constructor(
    private readonly config: SpawnerConfig,
    private readonly storage: StorageService,
    private readonly docker: DockerService,
  ) {}

  onModuleInit() {
    fs.mkdirSync(this.storage.traefikDir, { recursive: true });
    this.storage.writeAtomic(
      path.join(this.storage.traefikDir, "_spawner.yaml"),
      stringify({
        http: {
          routers: { spawner: this.router(this.config.dashboardHost, "spawner") },
          services: { spawner: { loadBalancer: { servers: [{ url: this.config.dashboardUpstream }] } } },
        },
      }),
    );
  }

  /**
   * Routes each exposure host to its service container.
   *
   * @param environmentId - Environment being published
   * @param composeProject - Compose project name (its network is <project>_default)
   * @param exposures - Hosts and the service port they reach
   */
  async publish(environmentId: string, composeProject: string, exposures: RoutedExposure[]): Promise<void> {
    try {
      await this.docker.connectNetwork(`${composeProject}_default`, this.config.traefikContainer);
    } catch (error) {
      throw new Error(`Traefik could not join the environment network: ${(error as Error).message} (container "${this.config.traefikContainer}", see SPAWNER_TRAEFIK_CONTAINER)`);
    }

    const routers: Record<string, unknown> = {};
    const services: Record<string, unknown> = {};
    for (const exposure of exposures) {
      const container = await this.docker.findServiceContainer(environmentId, exposure.service);
      if (!container) {
        throw new Error(`No container found for exposed service "${exposure.service}"`);
      }
      const id = `${environmentId}-${exposure.name}`;
      routers[id] = this.router(exposure.host, id);
      services[id] = { loadBalancer: { servers: [{ url: `http://${container.Names[0].replace(/^\//, "")}:${exposure.port}` }] } };
    }
    this.storage.writeAtomic(this.storage.traefikFile(environmentId), stringify({ http: { routers, services } }));
  }

  /**
   * Stops routing an environment and takes Traefik off its network.
   */
  async unpublish(environmentId: string, composeProject: string): Promise<void> {
    fs.rmSync(this.storage.traefikFile(environmentId), { force: true });
    try {
      await this.docker.disconnectNetwork(`${composeProject}_default`, this.config.traefikContainer);
    } catch (error) {
      this.logger.warn(`Could not disconnect Traefik from ${composeProject}_default: ${(error as Error).message}`);
    }
  }

  private router(host: string, service: string): Record<string, unknown> {
    return {
      rule: `Host(\`${host}\`)`,
      entryPoints: [this.config.entrypoint],
      service,
      ...(this.config.tls === "letsencrypt" ? { tls: { certResolver: this.config.certResolver } } : {}),
    };
  }
}
