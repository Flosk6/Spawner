import { Injectable } from "@nestjs/common";
import * as os from "os";
import * as path from "path";
import { DEFAULT_COMPOSE_LIMITS, parseDuration, parseSize, type ComposeLimits } from "@spawner/core";

const GiB = 1024 ** 3;

function integer(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? NaN : parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Engine settings, read once from the environment at startup.
 */
@Injectable()
export class SpawnerConfig {
  readonly dataDir = path.resolve(process.env.SPAWNER_DATA_DIR || "/var/lib/spawner");
  readonly keysDir = path.resolve(process.env.GIT_KEYS_PATH || path.join(this.dataDir, "keys"));
  readonly previewDomain = process.env.SPAWNER_PREVIEW_DOMAIN || "localtest.me";
  readonly tls = process.env.SPAWNER_TLS === "letsencrypt" ? ("letsencrypt" as const) : ("off" as const);
  readonly scheme: "http" | "https" = this.tls === "off" ? "http" : "https";
  readonly certResolver = process.env.SPAWNER_TLS_RESOLVER || "letsencrypt";
  readonly entrypoint = process.env.SPAWNER_TRAEFIK_ENTRYPOINT || (this.tls === "off" ? "web" : "websecure");
  readonly dashboardHost = process.env.SPAWNER_DASHBOARD_HOST || `spawner.${this.previewDomain}`;
  readonly dashboardUpstream = process.env.SPAWNER_DASHBOARD_UPSTREAM || "http://spawner:3000";
  readonly traefikContainer = process.env.SPAWNER_TRAEFIK_CONTAINER || "spawner-traefik";
  readonly dockerSocket = process.env.DOCKER_SOCKET || "/var/run/docker.sock";
  readonly bootstrapToken = process.env.SPAWNER_BOOTSTRAP_TOKEN || null;

  readonly buildConcurrency = integer(process.env.SPAWNER_BUILD_CONCURRENCY, os.totalmem() < 8 * GiB ? 1 : 2);
  readonly minFreeMemoryBytes = integer(process.env.MIN_REQUIRED_FREE_MEMORY_GB, 2) * GiB;
  readonly memoryCheckEnabled = process.env.ENABLE_MEMORY_CHECK !== "false";
  readonly startTimeoutSeconds = integer(process.env.SPAWNER_START_TIMEOUT_SECONDS, 300);
  readonly jobTimeoutSeconds = integer(process.env.SPAWNER_JOB_TIMEOUT_SECONDS, 30 * 60);

  readonly envTtlSeconds = parseDuration(process.env.SPAWNER_ENV_TTL || "72h") ?? 72 * 3600;
  readonly envTtlMaxSeconds = parseDuration(process.env.SPAWNER_ENV_TTL_MAX || "14d") ?? 14 * 86400;

  readonly composeLimits: ComposeLimits = {
    ...DEFAULT_COMPOSE_LIMITS,
    envMemoryBytes: parseSize(process.env.SPAWNER_ENV_MEMORY || "") ?? DEFAULT_COMPOSE_LIMITS.envMemoryBytes,
  };
  readonly envMemoryMaxBytes = parseSize(process.env.SPAWNER_ENV_MEMORY_MAX || "") ?? 4 * GiB;

  readonly uploadMaxBytes = parseSize(process.env.SPAWNER_UPLOAD_MAX || "100m") ?? 100 * 1024 ** 2;
  readonly uploadMaxFiles = integer(process.env.SPAWNER_UPLOAD_MAX_FILES, 50_000);
  readonly uploadMaxExtractedBytes = parseSize(process.env.SPAWNER_UPLOAD_MAX_EXTRACTED || "1g") ?? GiB;

  /**
   * Accepts file:// repositories. Only meant for tests: in production every
   * repository is reached over SSH or HTTPS.
   */
  readonly allowLocalRepos = process.env.SPAWNER_ALLOW_LOCAL_REPOS === "true";
}
