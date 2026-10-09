import type Docker from "dockerode";

/** Name of the container that runs the installer of the new version. */
export const UPGRADE_CONTAINER = "spawner-upgrade";

/** A version of Spawner, as the release tags give it: 2.0.0, 2.1.0-rc.1. */
export interface Version {
  major: number;
  minor: number;
  patch: number;
  prerelease: (string | number)[];
}

/** What GitHub answers for a release (GET /repos/:owner/:repo/releases). */
export interface GithubRelease {
  tag_name: string;
  name?: string | null;
  html_url?: string;
  published_at?: string | null;
  prerelease?: boolean;
  draft?: boolean;
  assets?: { name: string; browser_download_url: string }[] | null;
}

/** A release this server may move to. */
export interface Release {
  version: string;
  name: string;
  url: string | null;
  publishedAt: string | null;
  prerelease: boolean;
}

/** An update started from the dashboard, and how it went (UpdateRun in @spawner/types). */
export interface UpdateRun {
  from: string;
  to: string;
  by: string;
  startedAt: string;
  finishedAt: string | null;
  state: "running" | "succeeded" | "failed";
  phase: "downloading" | "installing" | null;
  error: string | null;
  log: string[];
}

/**
 * Reads a version, with or without its leading v; null for anything else
 * (build metadata, branches, malformed tags).
 */
export function parseVersion(raw: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part)) : [],
  };
}

/**
 * Semantic versioning precedence: negative when a comes before b. A
 * prerelease comes before its release (2.0.0-rc.2 before 2.0.0), numeric
 * identifiers compare as numbers (rc.10 after rc.9).
 */
export function compareVersions(a: Version, b: Version): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) {
      return a[key] - b[key];
    }
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return (a.prerelease.length === 0 ? 1 : 0) - (b.prerelease.length === 0 ? 1 : 0);
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const left = a.prerelease[index];
    const right = b.prerelease[index];
    if (left === undefined || right === undefined) {
      return left === undefined ? -1 : 1;
    }
    if (left !== right) {
      if (typeof left === "number" && typeof right === "number") {
        return left - right;
      }
      if (typeof left === "number" || typeof right === "number") {
        return typeof left === "number" ? -1 : 1;
      }
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

/**
 * The newest release a server running `current` may move to, or null when it
 * is up to date. A server on a release gets releases only; a server on a
 * prerelease gets prereleases too, until the release they lead to.
 */
export function newestUpdate(current: string, releases: GithubRelease[]): Release | null {
  const running = parseVersion(current);
  if (!running) {
    return null;
  }
  const allowPrereleases = running.prerelease.length > 0;
  let best: { version: Version; release: GithubRelease } | null = null;
  for (const release of releases) {
    const version = parseVersion(release.tag_name);
    if (!version || release.draft || (version.prerelease.length > 0 && !allowPrereleases)) {
      continue;
    }
    if (compareVersions(version, running) > 0 && (!best || compareVersions(version, best.version) > 0)) {
      best = { version, release };
    }
  }
  if (!best) {
    return null;
  }
  const version = best.release.tag_name.replace(/^v/, "");
  return {
    version,
    name: best.release.name || `Spawner ${version}`,
    url: best.release.html_url ?? null,
    publishedAt: best.release.published_at ?? null,
    prerelease: best.version.prerelease.length > 0,
  };
}

/**
 * Splits an image reference into its repository and tag, leaving out the
 * digest that pins it (install.sh runs release images as
 * repository:tag@sha256:...); null for a reference without a tag.
 */
export function splitImage(reference: string): { repository: string; tag: string } | null {
  const named = reference.split("@")[0];
  const slash = named.lastIndexOf("/");
  const colon = named.lastIndexOf(":");
  if (colon <= slash) {
    return null;
  }
  return { repository: named.slice(0, colon), tag: named.slice(colon + 1) };
}

/**
 * Where the installer of a version is published: the install.sh asset of its
 * release, or null when the list gives none (a list of your own).
 */
export function installerUrl(releases: GithubRelease[], version: string): string | null {
  const release = releases.find((candidate) => candidate.tag_name.replace(/^v/, "") === version);
  return release?.assets?.find((asset) => asset.name === "install.sh")?.browser_download_url ?? null;
}

/**
 * The digest of the image a published installer runs, which the release
 * workflow writes into it (IMAGE_DIGEST); null when it names none.
 */
export function installerDigest(installer: string): string | null {
  return /^IMAGE_DIGEST="(sha256:[0-9a-f]{64})"$/m.exec(installer)?.[1] ?? null;
}

/**
 * The container that upgrades the installation: the installer of the new
 * image, run as root with --upgrade on the host's network, with the Docker
 * socket, the installation directory and the data directory at their host
 * paths. It outlives the Spawner container it replaces; when the new
 * version does not start, the installer puts the previous one back.
 */
export function upgradeHelper(input: { image: string; version: string; installDir: string; dataDir: string; socket: string }): Docker.ContainerCreateOptions {
  return {
    name: UPGRADE_CONTAINER,
    Image: input.image,
    User: "0",
    Entrypoint: ["bash", "/app/install.sh"],
    Cmd: ["--upgrade", "--version", input.version, "--image", input.image, "--yes"],
    Env: [`SPAWNER_INSTALL_DIR=${input.installDir}`, `SPAWNER_DATA_DIR=${input.dataDir}`],
    Labels: { "dev.spawner.role": "upgrade", "dev.spawner.upgrade-to": input.version },
    HostConfig: {
      NetworkMode: "host",
      Binds: [`${input.socket}:/var/run/docker.sock`, `${input.installDir}:${input.installDir}`, `${input.dataDir}:${input.dataDir}`],
    },
  };
}
