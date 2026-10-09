import { Injectable } from "@nestjs/common";
import * as os from "os";
import * as path from "path";
import { DEFAULT_COMPOSE_LIMITS, parseDuration, parseSize, type ComposeLimits } from "@spawner/core";

const GiB = 1024 ** 3;

function integer(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? NaN : parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** A positive number, decimals allowed. */
function positive(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? NaN : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** A count where 0 means no limit. */
function count(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? NaN : parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Idle time before an environment sleeps; "never" or 0 turn sleeping off. */
function idleSeconds(value: string | undefined): number {
  if (value === "never" || value === "0") {
    return 0;
  }
  return parseDuration(value || "2h") ?? 2 * 3600;
}

/**
 * Engine settings, read from the environment at startup. The limits an admin
 * may change from the settings page (lifetimes, sleep, quotas, memory, build
 * guards) start from the environment, then the settings table overrides them
 * (LimitsService).
 */
@Injectable()
export class SpawnerConfig {
  readonly dataDir = path.resolve(process.env.SPAWNER_DATA_DIR || "/var/lib/spawner");
  readonly keysDir = path.resolve(process.env.GIT_KEYS_PATH || path.join(this.dataDir, "keys"));
  readonly previewDomain = process.env.SPAWNER_PREVIEW_DOMAIN || "localtest.me";
  readonly tls = process.env.SPAWNER_TLS === "letsencrypt" ? ("letsencrypt" as const) : ("off" as const);
  readonly scheme: "http" | "https" = this.tls === "off" ? "http" : "https";
  readonly certResolver = process.env.SPAWNER_TLS_RESOLVER || "letsencrypt";
  /**
   * One wildcard certificate (*.<preview domain>, DNS-01 challenge) for every
   * route, instead of one per host: Let's Encrypt allows about 50 a week.
   */
  readonly tlsWildcard = process.env.SPAWNER_TLS_WILDCARD === "true";
  /** Spawner looks for new versions every few hours (the dashboard offers to update); "false" stops it. */
  readonly updateCheck = process.env.SPAWNER_UPDATE_CHECK !== "false";
  /** Where the releases are listed: GitHub's API, or a file:// list in tests. */
  readonly releasesUrl = process.env.SPAWNER_RELEASES_URL || "https://api.github.com/repos/Flosk6/Spawner/releases?per_page=30";
  readonly entrypoint = process.env.SPAWNER_TRAEFIK_ENTRYPOINT || (this.tls === "off" ? "web" : "websecure");
  readonly dashboardHost = process.env.SPAWNER_DASHBOARD_HOST || `spawner.${this.previewDomain}`;
  /**
   * Spawner as Traefik reaches it, for the dashboard and the preview checks:
   * its name qualified by the network of the stack. Traefik also joins every
   * published environment network, and Docker's DNS answers a bare name from
   * the first of them that knows it.
   */
  readonly dashboardUpstream = process.env.SPAWNER_DASHBOARD_UPSTREAM || "http://spawner.spawner-core:3000";
  /** Public URL of the dashboard, without a trailing slash. */
  readonly dashboardUrl = (process.env.FRONTEND_URL || `${this.scheme}://${this.dashboardHost}`).replace(/\/+$/, "");
  /**
   * Origins the interface may run on: the dashboard, plus localhost without
   * TLS, where browsers allow passkeys over plain HTTP.
   */
  readonly dashboardOrigins = [
    new URL(this.dashboardUrl).origin,
    ...(this.tls === "off" ? ["http://localhost:8080", "http://localhost:5173"] : []),
  ];
  readonly traefikContainer = process.env.SPAWNER_TRAEFIK_CONTAINER || "spawner-traefik";
  readonly dockerSocket = process.env.DOCKER_SOCKET || "/var/run/docker.sock";
  readonly bootstrapToken = process.env.SPAWNER_BOOTSTRAP_TOKEN || null;
  /** Master secret; generated into the data directory when not set. */
  readonly secret = process.env.SPAWNER_SECRET || null;

  readonly buildConcurrency = integer(process.env.SPAWNER_BUILD_CONCURRENCY, os.totalmem() < 8 * GiB ? 1 : 2);
  /** Memory a build needs available before it starts (0: no check). */
  minFreeMemoryBytes = count(process.env.MIN_REQUIRED_FREE_MEMORY_GB, 2) * GiB;
  /** Disk a build needs free before it starts (0: no check). */
  minFreeDiskBytes = count(process.env.MIN_REQUIRED_FREE_DISK_GB, 10) * GiB;
  readonly memoryCheckEnabled = process.env.ENABLE_MEMORY_CHECK !== "false";
  readonly startTimeoutSeconds = integer(process.env.SPAWNER_START_TIMEOUT_SECONDS, 300);
  readonly jobTimeoutSeconds = integer(process.env.SPAWNER_JOB_TIMEOUT_SECONDS, 30 * 60);

  envTtlSeconds = parseDuration(process.env.SPAWNER_ENV_TTL || "72h") ?? 72 * 3600;
  envTtlMaxSeconds = parseDuration(process.env.SPAWNER_ENV_TTL_MAX || "14d") ?? 14 * 86400;
  /** Time without activity before an environment sleeps (0: never). */
  envIdleSeconds = idleSeconds(process.env.SPAWNER_ENV_IDLE);
  /** Live environments a person may own, sleeping ones included (0: no limit). */
  envsPerUser = count(process.env.SPAWNER_ENVS_PER_USER, 5);

  readonly composeLimits: ComposeLimits = {
    ...DEFAULT_COMPOSE_LIMITS,
    envMemoryBytes: parseSize(process.env.SPAWNER_ENV_MEMORY || "") ?? DEFAULT_COMPOSE_LIMITS.envMemoryBytes,
    envCpus: positive(process.env.SPAWNER_ENV_CPUS, DEFAULT_COMPOSE_LIMITS.envCpus),
    envPids: integer(process.env.SPAWNER_ENV_PIDS, DEFAULT_COMPOSE_LIMITS.envPids),
  };
  envMemoryMaxBytes = parseSize(process.env.SPAWNER_ENV_MEMORY_MAX || "") ?? 4 * GiB;

  readonly uploadMaxBytes = parseSize(process.env.SPAWNER_UPLOAD_MAX || "100m") ?? 100 * 1024 ** 2;
  readonly uploadMaxFiles = integer(process.env.SPAWNER_UPLOAD_MAX_FILES, 50_000);
  readonly uploadMaxExtractedBytes = parseSize(process.env.SPAWNER_UPLOAD_MAX_EXTRACTED || "1g") ?? GiB;

  /**
   * Accepts file:// repositories. Only meant for tests: in production every
   * repository is reached over SSH or HTTPS.
   */
  readonly allowLocalRepos = process.env.SPAWNER_ALLOW_LOCAL_REPOS === "true";
}
