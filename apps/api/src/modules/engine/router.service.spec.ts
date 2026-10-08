import { Logger } from "@nestjs/common";
import { composeProjectName } from "@spawner/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parse } from "yaml";
import type { DockerService } from "../../common/docker.service";
import type { PrismaService } from "../../common/prisma.service";
import type { SecretsService } from "../../common/secrets.service";
import type { SpawnerConfig } from "../../common/spawner.config";
import { bareUpstreamHost, RouterService } from "./router.service";
import type { StorageService } from "./storage.service";

describe("bareUpstreamHost", () => {
  it("names the hosts Docker's DNS may answer from any network of Traefik", () => {
    expect(bareUpstreamHost("http://spawner:3000")).toBe("spawner");
    expect(bareUpstreamHost("http://spawner.spawner-core:3000")).toBeNull();
    expect(bareUpstreamHost("http://10.0.0.2:3000")).toBeNull();
    expect(bareUpstreamHost("http://[fd00::2]:3000")).toBeNull();
    expect(bareUpstreamHost("http://localhost:3000")).toBeNull();
  });
});

describe("RouterService", () => {
  let dir: string;
  let config: Record<string, unknown>;
  let connections: { network: string; container: string; priority?: number }[];

  const storage = () =>
    ({
      traefikDir: dir,
      traefikFile: (id: string) => path.join(dir, `${id}.yaml`),
      writeAtomic: (target: string, content: string) => fs.writeFileSync(target, content),
    }) as unknown as StorageService;
  const docker = {
    connectNetwork: async (network: string, container: string, priority?: number) => void connections.push({ network, container, priority }),
    disconnectNetwork: async () => undefined,
    findServiceContainer: async (env: string, service: string) => (env === "gone" ? null : { Names: [`/spn-blog--${env}-${service}-1`] }),
  } as unknown as DockerService;
  const router = (prisma = {} as PrismaService) => new RouterService(config as unknown as SpawnerConfig, storage(), docker, {} as SecretsService, prisma);
  const read = (file: string) => parse(fs.readFileSync(path.join(dir, file), "utf8"));
  const exposures = [
    { name: "web", service: "web", port: 3000, host: "feat--blog.preview.example.com", auth: "team" },
    { name: "hook", service: "api", port: 8000, host: "hook--feat--blog.preview.example.com", auth: "none" },
  ];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "spawner-router-"));
    connections = [];
    config = {
      dashboardHost: "spawner.preview.example.com",
      dashboardUpstream: "http://spawner.spawner-core:3000",
      previewDomain: "preview.example.com",
      entrypoint: "websecure",
      tls: "letsencrypt",
      certResolver: "letsencrypt",
      tlsWildcard: false,
      traefikContainer: "spawner-traefik",
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reaches each service by its name qualified by the environment network, which Traefik joins below its own", async () => {
    await router().publish("feat", "spn-blog--feat", exposures);
    const { services } = read("feat.yaml").http;
    expect(services["feat-web"].loadBalancer.servers).toEqual([{ url: "http://web.spn-blog--feat_default:3000" }]);
    expect(services["feat-hook"].loadBalancer.servers).toEqual([{ url: "http://api.spn-blog--feat_default:8000" }]);
    expect(connections).toEqual([{ network: "spn-blog--feat_default", container: "spawner-traefik", priority: -1 }]);
  });

  it("keeps every label of an upstream host within 63 characters, with the longest slugs and service name", async () => {
    const project = "p".repeat(20);
    const env = "e".repeat(29);
    const service = "s".repeat(63);
    await router().publish("long", composeProjectName(project, env), [{ name: "web", service, port: 80, host: "long.preview.example.com", auth: "team" }]);
    const url = new URL(read("long.yaml").http.services["long-web"].loadBalancer.servers[0].url);
    expect(url.hostname.split(".").map((label) => label.length)).toEqual([63, 63]);
  });

  it("warns at startup when Spawner's own upstream is a bare name", () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    router().onModuleInit();
    expect(warn).not.toHaveBeenCalled();
    expect(read("_spawner.yaml").http.services.spawner.loadBalancer.servers).toEqual([{ url: "http://spawner.spawner-core:3000" }]);

    config.dashboardUpstream = "http://spawner:3000";
    router().onModuleInit();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SPAWNER_DASHBOARD_UPSTREAM names "spawner" without its network'));
  });

  it("publishes the awake environments again at startup, and goes on past one that fails", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const queries: unknown[] = [];
    const prisma = {
      environment: {
        findMany: async (query: unknown) => {
          queries.push(query);
          return [
            { id: "gone", slug: "gone", project: { slug: "blog" }, exposures: [exposures[0]] },
            { id: "feat", slug: "feat", project: { slug: "blog" }, exposures },
          ];
        },
      },
    } as unknown as PrismaService;

    expect(await router(prisma).republishAwake()).toBe(1);
    expect(queries[0]).toMatchObject({
      where: { deletedAt: null, status: { in: ["ready", "degraded"] }, NOT: { jobs: { some: { status: { in: ["queued", "running"] } } } } },
    });
    expect(connections.map((connection) => connection.network)).toEqual(["spn-blog--gone_default", "spn-blog--feat_default"]);
    expect(fs.existsSync(path.join(dir, "gone.yaml"))).toBe(false);
    expect(read("feat.yaml").http.services["feat-web"].loadBalancer.servers[0].url).toBe("http://web.spn-blog--feat_default:3000");
  });

  it("hands the applications, public or not, their requests without Spawner's cookies, and the waiting page with them", async () => {
    const service = router();
    service.onModuleInit();
    const middlewares = read("_spawner.yaml").http.middlewares;
    expect(middlewares["spawner-preview-gate"].forwardAuth).toEqual({
      address: "http://spawner.spawner-core:3000/api/v1/auth/verify",
      authRequestHeaders: ["Accept", "Cookie", "X-Spawner-Preview"],
      authResponseHeaders: ["Cookie"],
    });
    expect(middlewares["spawner-preview-auth"].forwardAuth.authResponseHeaders).toBeUndefined();

    await service.publish("env1", "spn-blog--feat", exposures);
    const routers = read("env1.yaml").http.routers;
    expect(routers["env1-web"].middlewares).toEqual(["spawner-preview-gate", "spawner-preview-strip"]);
    expect(routers["env1-hook"].middlewares).toEqual(["spawner-public-gate", "spawner-preview-strip"]);
    expect(middlewares["spawner-public-gate"].forwardAuth).toMatchObject({ address: "http://spawner.spawner-core:3000/api/v1/auth/verify-public", authResponseHeaders: ["Cookie"] });

    await service.publishPlaceholder("env1", "spn-blog--feat", exposures);
    const placeholders = read("env1.yaml").http.routers;
    expect(placeholders["env1-web"]).toMatchObject({ service: "spawner", middlewares: ["spawner-preview-auth", "spawner-wake"] });
    expect(placeholders["env1-hook"].middlewares).toEqual(["spawner-wake"]);
  });

  it("asks for a certificate per host, or for the wildcard of the preview domain", async () => {
    await router().publish("env1", "spn-blog--feat", exposures);
    expect(read("env1.yaml").http.routers["env1-web"].tls).toEqual({ certResolver: "letsencrypt" });

    config.tlsWildcard = true;
    await router().publish("env1", "spn-blog--feat", exposures);
    expect(read("env1.yaml").http.routers["env1-web"].tls).toEqual({
      certResolver: "letsencrypt",
      domains: [{ main: "preview.example.com", sans: ["*.preview.example.com"] }],
    });

    config.tls = "off";
    await router().publish("env1", "spn-blog--feat", exposures);
    expect(read("env1.yaml").http.routers["env1-web"].tls).toBeUndefined();
  });
});
