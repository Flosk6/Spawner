import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import { stringify } from "yaml";
import { DockerService } from "../../common/docker.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { StorageService } from "./storage.service";

export interface RoutedExposure {
  name: string;
  service: string;
  port: number;
  host: string;
  /** "team": only the team and share links reach it; "none": public. */
  auth: string;
}

/**
 * Traefik middlewares of the protected exposures, declared once in the
 * dashboard's file: Spawner checks each request (forwardAuth), then the
 * preview token header is removed before the request reaches the
 * application.
 */
const PREVIEW_MIDDLEWARES = ["spawner-preview-auth", "spawner-preview-strip"];

/** Traefik applies a changed file within a couple of seconds. */
const ROUTE_WAIT_MS = 15_000;
const ROUTE_POLL_MS = 250;

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
          middlewares: {
            "spawner-preview-auth": {
              forwardAuth: {
                address: `${this.config.dashboardUpstream}/api/v1/auth/verify`,
                authRequestHeaders: ["Accept", "Cookie", "X-Spawner-Preview"],
              },
            },
            "spawner-preview-strip": { headers: { customRequestHeaders: { "X-Spawner-Preview": "" } } },
          },
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
      routers[id] = { ...this.router(exposure.host, id), ...(exposure.auth === "none" ? {} : { middlewares: PREVIEW_MIDDLEWARES }) };
      services[id] = { loadBalancer: { servers: [{ url: `http://${container.Names[0].replace(/^\//, "")}:${exposure.port}` }] } };
    }
    this.storage.writeAtomic(this.storage.traefikFile(environmentId), stringify({ http: { routers, services } }));
  }

  /**
   * Waits until Traefik serves each host, so that an environment announced
   * ready answers on its URLs. A host is not served yet while Traefik
   * answers its own "404 page not found" for it.
   */
  async waitUntilServed(hosts: string[], log: (line: string) => void): Promise<void> {
    const deadline = Date.now() + ROUTE_WAIT_MS;
    for (const host of hosts) {
      while (!(await this.isServed(host))) {
        if (Date.now() > deadline) {
          log(`Traefik does not serve ${host} yet; it should within seconds`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, ROUTE_POLL_MS));
      }
    }
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

  private isServed(host: string): Promise<boolean> {
    const secure = this.config.tls !== "off";
    return new Promise((resolve) => {
      const request = (secure ? https : http).request(
        {
          host: this.config.traefikContainer,
          port: secure ? 443 : 80,
          path: "/",
          headers: { host, accept: "application/json" },
          servername: host,
          rejectUnauthorized: false,
          timeout: 2000,
        },
        (response) => {
          let body = "";
          response.on("data", (chunk) => (body += chunk));
          response.on("end", () => resolve(!(response.statusCode === 404 && body.trim() === "404 page not found")));
        },
      );
      // Without Traefik's name (Spawner started outside Docker) there is nothing to wait for.
      request.on("error", (error: NodeJS.ErrnoException) => resolve(error.code === "ENOTFOUND" || error.code === "EAI_AGAIN"));
      request.on("timeout", () => request.destroy());
      request.end();
    });
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
