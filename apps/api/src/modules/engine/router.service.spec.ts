import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parse } from "yaml";
import type { DockerService } from "../../common/docker.service";
import type { SecretsService } from "../../common/secrets.service";
import type { SpawnerConfig } from "../../common/spawner.config";
import { RouterService } from "./router.service";
import type { StorageService } from "./storage.service";

describe("RouterService", () => {
  let dir: string;
  let config: Record<string, unknown>;

  const storage = () =>
    ({
      traefikDir: dir,
      traefikFile: (id: string) => path.join(dir, `${id}.yaml`),
      writeAtomic: (target: string, content: string) => fs.writeFileSync(target, content),
    }) as unknown as StorageService;
  const docker = {
    connectNetwork: async () => undefined,
    disconnectNetwork: async () => undefined,
    findServiceContainer: async (_env: string, service: string) => ({ Names: [`/spn-blog--feat-${service}-1`] }),
  } as unknown as DockerService;
  const router = () => new RouterService(config as unknown as SpawnerConfig, storage(), docker, {} as SecretsService);
  const read = (file: string) => parse(fs.readFileSync(path.join(dir, file), "utf8"));
  const exposures = [
    { name: "web", service: "web", port: 3000, host: "feat--blog.preview.example.com", auth: "team" },
    { name: "hook", service: "api", port: 8000, host: "hook--feat--blog.preview.example.com", auth: "none" },
  ];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "spawner-router-"));
    config = {
      dashboardHost: "spawner.preview.example.com",
      dashboardUpstream: "http://spawner:3000",
      previewDomain: "preview.example.com",
      entrypoint: "websecure",
      tls: "letsencrypt",
      certResolver: "letsencrypt",
      tlsWildcard: false,
      traefikContainer: "spawner-traefik",
    };
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("hands the applications, public or not, their requests without Spawner's cookies, and the waiting page with them", async () => {
    const service = router();
    service.onModuleInit();
    const middlewares = read("_spawner.yaml").http.middlewares;
    expect(middlewares["spawner-preview-gate"].forwardAuth).toEqual({
      address: "http://spawner:3000/api/v1/auth/verify",
      authRequestHeaders: ["Accept", "Cookie", "X-Spawner-Preview"],
      authResponseHeaders: ["Cookie"],
    });
    expect(middlewares["spawner-preview-auth"].forwardAuth.authResponseHeaders).toBeUndefined();

    await service.publish("env1", "spn-blog--feat", exposures);
    const routers = read("env1.yaml").http.routers;
    expect(routers["env1-web"].middlewares).toEqual(["spawner-preview-gate", "spawner-preview-strip"]);
    expect(routers["env1-hook"].middlewares).toEqual(["spawner-public-gate", "spawner-preview-strip"]);
    expect(middlewares["spawner-public-gate"].forwardAuth).toMatchObject({ address: "http://spawner:3000/api/v1/auth/verify-public", authResponseHeaders: ["Cookie"] });

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
