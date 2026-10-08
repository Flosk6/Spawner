import { describe, expect, it } from "vitest";
import { compareVersions, newestUpdate, parseVersion, splitImage, upgradeHelper, type GithubRelease } from "./releases";

const release = (tag: string, extra: Partial<GithubRelease> = {}): GithubRelease => ({
  tag_name: tag,
  name: `Spawner ${tag.slice(1)}`,
  html_url: `https://github.com/Flosk6/Spawner/releases/tag/${tag}`,
  published_at: "2026-10-08T10:00:00Z",
  prerelease: tag.includes("-"),
  draft: false,
  ...extra,
});

describe("versions", () => {
  it("reads release tags, and nothing else", () => {
    expect(parseVersion("v2.0.0-rc.1")).toEqual({ major: 2, minor: 0, patch: 0, prerelease: ["rc", 1] });
    expect(parseVersion("2.1.3")).toEqual({ major: 2, minor: 1, patch: 3, prerelease: [] });
    for (const raw of ["latest", "v2", "2.0", "2.0.0+build", "v1.0.1-", "master"]) {
      expect(parseVersion(raw)).toBeNull();
    }
  });

  it("orders them as semantic versioning does", () => {
    const ordered = ["1.9.9", "2.0.0-alpha", "2.0.0-rc.1", "2.0.0-rc.2", "2.0.0-rc.10", "2.0.0", "2.0.1", "2.1.0", "10.0.0"];
    for (let index = 1; index < ordered.length; index++) {
      expect(compareVersions(parseVersion(ordered[index - 1])!, parseVersion(ordered[index])!), `${ordered[index - 1]} < ${ordered[index]}`).toBeLessThan(0);
      expect(compareVersions(parseVersion(ordered[index])!, parseVersion(ordered[index - 1])!)).toBeGreaterThan(0);
    }
    expect(compareVersions(parseVersion("2.0.0")!, parseVersion("v2.0.0")!)).toBe(0);
  });
});

describe("newestUpdate", () => {
  const releases = [release("v2.0.0-rc.1"), release("v2.0.0-rc.2"), release("v2.0.0"), release("v2.0.1"), release("v2.1.0-rc.1"), release("v1.0.1")];

  it("offers the newest release to a server on a release, never a prerelease", () => {
    expect(newestUpdate("2.0.0", releases)).toMatchObject({ version: "2.0.1", prerelease: false, url: "https://github.com/Flosk6/Spawner/releases/tag/v2.0.1" });
    expect(newestUpdate("2.0.1", releases)).toBeNull();
  });

  it("offers prereleases to a server on a prerelease", () => {
    expect(newestUpdate("2.0.0-rc.1", releases)).toMatchObject({ version: "2.1.0-rc.1", prerelease: true });
    expect(newestUpdate("2.0.0-rc.1", releases.slice(0, 3))).toMatchObject({ version: "2.0.0", prerelease: false });
  });

  it("ignores drafts, malformed tags and unknown current versions", () => {
    expect(newestUpdate("2.0.0", [release("v2.0.1", { draft: true }), release("nightly")])).toBeNull();
    expect(newestUpdate("unknown", releases)).toBeNull();
  });
});

describe("splitImage", () => {
  it("separates the repository from the tag, registry ports included", () => {
    expect(splitImage("ghcr.io/flosk6/spawner:2.0.0-rc.1")).toEqual({ repository: "ghcr.io/flosk6/spawner", tag: "2.0.0-rc.1" });
    expect(splitImage("registry.local:5000/spawner:2.0.0")).toEqual({ repository: "registry.local:5000/spawner", tag: "2.0.0" });
    expect(splitImage("registry.local:5000/spawner")).toBeNull();
    expect(splitImage("ghcr.io/flosk6/spawner@sha256:abc")).toBeNull();
  });
});

describe("upgradeHelper", () => {
  it("runs the new version's installer as root, on the host's network, with the installation at its host paths", () => {
    const spec = upgradeHelper({
      image: "ghcr.io/flosk6/spawner:2.0.1",
      version: "2.0.1",
      installDir: "/opt/spawner",
      dataDir: "/var/lib/spawner",
      socket: "/var/run/docker.sock",
    });
    expect(spec).toMatchObject({
      name: "spawner-upgrade",
      Image: "ghcr.io/flosk6/spawner:2.0.1",
      User: "0",
      Entrypoint: ["bash", "/app/install.sh"],
      Cmd: ["--upgrade", "--version", "2.0.1", "--image", "ghcr.io/flosk6/spawner:2.0.1", "--yes"],
      Env: ["SPAWNER_INSTALL_DIR=/opt/spawner", "SPAWNER_DATA_DIR=/var/lib/spawner"],
      HostConfig: {
        NetworkMode: "host",
        Binds: ["/var/run/docker.sock:/var/run/docker.sock", "/opt/spawner:/opt/spawner", "/var/lib/spawner:/var/lib/spawner"],
      },
    });
  });
});
