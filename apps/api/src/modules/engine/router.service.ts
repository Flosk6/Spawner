import { Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from "@nestjs/common";
import { composeProjectName } from "@spawner/core";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import { stringify } from "yaml";
import { DockerService } from "../../common/docker.service";
import { PrismaService } from "../../common/prisma.service";
import { SecretsService } from "../../common/secrets.service";
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
 * dashboard's file: Spawner checks each request (forwardAuth) and hands its
 * cookies back without Spawner's own, which replace the original ones; then
 * the preview token header is removed. The application of a branch never
 * sees what opens the other previews.
 */
const PREVIEW_MIDDLEWARES = ["spawner-preview-gate", "spawner-preview-strip"];

/**
 * Middlewares of the public exposures: every request passes, without
 * Spawner's cookies and the preview token header either.
 */
const PUBLIC_MIDDLEWARES = ["spawner-public-gate", "spawner-preview-strip"];

/**
 * Rewrites a request for a sleeping or stopped environment into one for
 * Spawner's waiting page (Traefik keeps the original path in
 * X-Replaced-Path).
 */
const WAKE_MIDDLEWARE = "spawner-wake";
export const WAKE_PATH = "/api/v1/wake";

/** Traefik applies a changed file within a couple of seconds. */
const ROUTE_WAIT_MS = 15_000;
/** Route files hold no secret; Traefik, root without capabilities, reads them as any other user would. */
const ROUTES_MODE = 0o644;
const ROUTE_POLL_MS = 250;
/** Header of the answers of Spawner's waiting page. */
export const WAKE_HEADER = "x-spawner-wake";

/**
 * Priority of the environment networks among Traefik's, below the 0 of
 * Spawner's own network: Docker's DNS asks spawner-core first, and Traefik's
 * default route stays on it.
 */
const ENVIRONMENT_NETWORK_PRIORITY = -1;

/**
 * The host of an upstream URL when it is a bare name, which Docker's DNS
 * may answer from any network of Traefik; null when it is qualified by a
 * network or a domain, an IP address, or localhost.
 */
export function bareUpstreamHost(upstream: string): string | null {
  let host: string;
  try {
    host = new URL(upstream).hostname;
  } catch {
    return null;
  }
  return host.includes(".") || host.startsWith("[") || host === "localhost" ? null : host;
}

/**
 * Publishes environments through Traefik's file provider: one dynamic
 * configuration file per environment, so Traefik never needs the Docker
 * socket. Traefik joins each environment network while it is published and
 * leaves it afterwards; environments share no network with each other.
 */
@Injectable()
export class RouterService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(RouterService.name);

  constructor(
    private readonly config: SpawnerConfig,
    private readonly storage: StorageService,
    private readonly docker: DockerService,
    private readonly secrets: SecretsService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    const bare = bareUpstreamHost(this.config.dashboardUpstream);
    if (bare) {
      this.logger.warn(
        `SPAWNER_DASHBOARD_UPSTREAM names "${bare}" without its network: Traefik joins every environment network, where an environment could answer to that name. Qualify it, such as http://spawner.spawner-core:3000`,
      );
    }
    fs.mkdirSync(this.storage.traefikDir, { recursive: true });
    this.storage.writeAtomic(
      path.join(this.storage.traefikDir, "_spawner.yaml"),
      stringify({
        http: {
          routers: { spawner: this.router(this.config.dashboardHost, "spawner") },
          services: { spawner: { loadBalancer: { servers: [{ url: this.config.dashboardUpstream }] } } },
          middlewares: {
            "spawner-preview-auth": { forwardAuth: this.forwardAuth() },
            "spawner-preview-gate": { forwardAuth: { ...this.forwardAuth(), authResponseHeaders: ["Cookie"] } },
            "spawner-public-gate": {
              forwardAuth: { address: `${this.config.dashboardUpstream}/api/v1/auth/verify-public`, authRequestHeaders: ["Cookie"], authResponseHeaders: ["Cookie"] },
            },
            "spawner-preview-strip": { headers: { customRequestHeaders: { "X-Spawner-Preview": "" } } },
            [WAKE_MIDDLEWARE]: { replacePath: { path: WAKE_PATH } },
          },
        },
      }),
      ROUTES_MODE,
    );
  }

  /**
   * Publishes the awake environments again once Spawner has started, before
   * it serves requests: their route files may come from an older version,
   * and Traefik leaves their networks when its container is recreated.
   * Sleeping and stopped environments lead to the waiting page through the
   * routes of _spawner.yaml, written at every start.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === "test") {
      return;
    }
    try {
      await this.republishAwake();
    } catch (error) {
      this.logger.error(`Could not publish the awake environments again: ${(error as Error).message}`);
    }
  }

  /**
   * Publishes again every awake environment (ready or degraded) that has no
   * job queued or running; the job publishes it otherwise. A failure is
   * logged, and the others go on.
   *
   * @returns How many environments were published
   */
  async republishAwake(): Promise<number> {
    const environments = await this.prisma.environment.findMany({
      where: {
        deletedAt: null,
        status: { in: ["ready", "degraded"] },
        NOT: { jobs: { some: { status: { in: ["queued", "running"] } } } },
      },
      select: { id: true, slug: true, project: { select: { slug: true } }, exposures: true },
    });
    let published = 0;
    for (const environment of environments) {
      try {
        await this.publish(environment.id, composeProjectName(environment.project.slug, environment.slug), environment.exposures);
        published++;
      } catch (error) {
        this.logger.warn(`Could not publish ${environment.project.slug}/${environment.slug} again: ${(error as Error).message}`);
      }
    }
    if (published > 0) {
      this.logger.log(`Published the routes of ${published} awake environment(s) again`);
    }
    return published;
  }

  /**
   * Routes each exposure host to its service container. Traefik joins the
   * environment network, below Spawner's own, and reaches each service by
   * its name qualified by that network (<service>.<project>_default):
   * Docker's DNS answers a bare name from the first of Traefik's networks
   * that knows it, which could belong to another environment. The service
   * name, rather than the container's, keeps every label of the host within
   * the 63 characters a DNS resolver accepts.
   *
   * @param environmentId - Environment being published
   * @param composeProject - Compose project name (its network is <project>_default)
   * @param exposures - Hosts and the service port they reach
   */
  async publish(environmentId: string, composeProject: string, exposures: RoutedExposure[]): Promise<void> {
    const network = `${composeProject}_default`;
    try {
      await this.docker.connectNetwork(network, this.config.traefikContainer, ENVIRONMENT_NETWORK_PRIORITY);
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
      routers[id] = { ...this.router(exposure.host, id), middlewares: exposure.auth === "none" ? PUBLIC_MIDDLEWARES : PREVIEW_MIDDLEWARES };
      services[id] = { loadBalancer: { servers: [{ url: `http://${exposure.service}.${network}:${exposure.port}` }] } };
    }
    this.storage.writeAtomic(this.storage.traefikFile(environmentId), stringify({ http: { routers, services } }), ROUTES_MODE);
  }

  /**
   * Routes the hosts of a sleeping or stopped environment to Spawner's
   * waiting page, which wakes it up (team URLs) or says how to, and takes
   * Traefik off its network. Team URLs keep their protection; the preview
   * header and Spawner's cookies are left in place, since they only reach
   * Spawner, whose waiting page checks them again.
   */
  async publishPlaceholder(environmentId: string, composeProject: string, exposures: RoutedExposure[]): Promise<void> {
    const routers: Record<string, unknown> = {};
    for (const exposure of exposures) {
      const id = `${environmentId}-${exposure.name}`;
      routers[id] = {
        ...this.router(exposure.host, "spawner"),
        middlewares: exposure.auth === "none" ? [WAKE_MIDDLEWARE] : ["spawner-preview-auth", WAKE_MIDDLEWARE],
      };
    }
    this.storage.writeAtomic(this.storage.traefikFile(environmentId), stringify({ http: { routers } }), ROUTES_MODE);
    try {
      await this.docker.disconnectNetwork(`${composeProject}_default`, this.config.traefikContainer);
    } catch (error) {
      this.logger.warn(`Could not disconnect Traefik from ${composeProject}_default: ${(error as Error).message}`);
    }
  }

  /**
   * Waits until Traefik serves each host from the environment's containers,
   * so that an environment announced ready answers on its URLs. A host is
   * not served yet while Traefik answers its own "404 page not found" for it,
   * or while the answer still comes from Spawner's waiting page. The probe
   * carries a preview token, so that protected URLs let it through.
   */
  async waitUntilServed(environmentId: string, hosts: string[], log: (line: string) => void): Promise<void> {
    const deadline = Date.now() + ROUTE_WAIT_MS;
    const token = this.secrets.sign("preview-header", { exp: Math.floor(Date.now() / 1000) + 120, env: environmentId });
    for (const host of hosts) {
      while (!(await this.isServed(host, token))) {
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

  private isServed(host: string, token: string): Promise<boolean> {
    const secure = this.config.tls !== "off";
    return new Promise((resolve) => {
      const request = (secure ? https : http).request(
        {
          host: this.config.traefikContainer,
          port: secure ? 443 : 80,
          path: "/",
          headers: { host, accept: "application/json", "x-spawner-preview": token },
          servername: host,
          rejectUnauthorized: false,
          timeout: 2000,
        },
        (response) => {
          let body = "";
          response.on("data", (chunk) => (body += chunk));
          response.on("end", () => resolve(!(response.statusCode === 404 && body.trim() === "404 page not found") && !response.headers[WAKE_HEADER]));
        },
      );
      // Without Traefik's name (Spawner started outside Docker) there is nothing to wait for.
      request.on("error", (error: NodeJS.ErrnoException) => resolve(error.code === "ENOTFOUND" || error.code === "EAI_AGAIN"));
      request.on("timeout", () => request.destroy());
      request.end();
    });
  }

  /**
   * Asks Spawner whether a request to a protected preview may pass, with
   * the only headers it decides on.
   */
  private forwardAuth(): Record<string, unknown> {
    return {
      address: `${this.config.dashboardUpstream}/api/v1/auth/verify`,
      authRequestHeaders: ["Accept", "Cookie", "X-Spawner-Preview", "Origin", "Access-Control-Request-Method"],
    };
  }

  private router(host: string, service: string): Record<string, unknown> {
    return {
      rule: `Host(\`${host}\`)`,
      entryPoints: [this.config.entrypoint],
      service,
      ...(this.config.tls === "letsencrypt" ? { tls: this.tls() } : {}),
    };
  }

  /**
   * The certificate of a route: one per host, or the wildcard of the preview
   * domain, which Traefik requests once and shares between every route.
   */
  private tls(): Record<string, unknown> {
    if (!this.config.tlsWildcard) {
      return { certResolver: this.config.certResolver };
    }
    const domain = this.config.previewDomain;
    return { certResolver: this.config.certResolver, domains: [{ main: domain, sans: [`*.${domain}`] }] };
  }
}
