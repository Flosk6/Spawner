import * as fs from "fs";
import * as path from "path";
import type { ServerInfo } from "@spawner/types";
import { describe, expect, it } from "vitest";
import { checkProject } from "./check";
import { COMPOSE, MANIFEST, repo, tempDir, write } from "./testing/repo";
import { INFO } from "./testing/fake-api";
import { loadWorkspace } from "./workspace";

const info = INFO as ServerInfo;

describe("checkProject", () => {
  it("accepts a valid project, as the server would", async () => {
    const root = repo({ ".spawner/spawner.yaml": MANIFEST, ".spawner/compose.yaml": COMPOSE, Dockerfile: "FROM node:22" });
    const check = checkProject((await loadWorkspace(root))!, "feat-login", info, {});
    expect(check.issues).toEqual([]);
    expect(check.services).toEqual(["db", "app"]);
  });

  it("refuses what the server refuses, with the path of the key", async () => {
    const compose = COMPOSE.replace("    build: ..\n", "    build: ..\n    ports: ['8080:3000']\n    privileged: true\n");
    const root = repo({ ".spawner/spawner.yaml": MANIFEST, ".spawner/compose.yaml": compose });
    const check = checkProject((await loadWorkspace(root))!, "feat-login", info, {});
    expect(check.issues.map((issue) => `${issue.code} ${issue.path}`)).toEqual(
      expect.arrayContaining(["compose.forbidden_key services.app.ports", "compose.forbidden_key services.app.privileged"]),
    );
  });

  it("reports a broken manifest and a missing compose file", async () => {
    const broken = repo({ ".spawner/spawner.yaml": "version: 1\nproject: Example\n" });
    expect(checkProject((await loadWorkspace(broken))!, "x", info, {}).issues[0].path).toMatch(/^spawner\.yaml/);
    const missing = repo({ ".spawner/spawner.yaml": MANIFEST });
    expect(checkProject((await loadWorkspace(missing))!, "x", info, {}).issues[0]).toMatchObject({ code: "compose.path_not_found" });
  });

  it("checks the paths of uploaded sources, not those of sources taken from git", async () => {
    const manifest = `${MANIFEST}sources:\n  front:\n    repo: git@github.com:acme/front.git\n`;
    const compose = COMPOSE.replace("volumes:\n  db-data:\n", "  front:\n    build: ${SPAWNER_SRC_FRONT}/web\nvolumes:\n  db-data:\n");
    const root = repo({ ".spawner/spawner.yaml": manifest, ".spawner/compose.yaml": compose });
    const workspace = (await loadWorkspace(root))!;
    expect(checkProject(workspace, "x", info, {}).issues).toEqual([]);

    const front = tempDir();
    expect(checkProject(workspace, "x", info, { front }).issues[0]).toMatchObject({ code: "compose.path_not_found" });
    fs.mkdirSync(path.join(front, "web"));
    write(front, "web/Dockerfile", "FROM nginx");
    expect(checkProject(workspace, "x", info, { front }).issues).toEqual([]);
  });

  it("applies the server's limits", async () => {
    const compose = COMPOSE.replace("    build: ..\n", "    build: ..\n    mem_limit: 3g\n");
    const root = repo({ ".spawner/spawner.yaml": `${MANIFEST}limits:\n  memory: 4g\n`, ".spawner/compose.yaml": compose });
    const workspace = (await loadWorkspace(root))!;
    expect(checkProject(workspace, "x", info, {}).issues).toEqual([]);
    const strict = { ...info, limits: { ...info.limits, compose: { ...info.limits.compose, envMemoryMaxBytes: 2 * 1024 ** 3 } } };
    expect(checkProject(workspace, "x", strict, {}).issues[0]).toMatchObject({ code: "compose.limit_exceeded" });
  });
});
