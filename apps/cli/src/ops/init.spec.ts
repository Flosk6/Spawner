import * as fs from "fs";
import * as path from "path";
import type { ServerInfo } from "@spawner/types";
import { describe, expect, it } from "vitest";
import { checkProject } from "../check";
import { INFO } from "../testing/fake-api";
import { repo, tempDir, write } from "../testing/repo";
import { loadWorkspace } from "../workspace";
import { AGENTS_HEADING, detectDatabase, detectPort, init, projectSlug } from "./init";

describe("init", () => {
  it.each(["postgres", "mysql", "none"] as const)("writes files the server accepts (database: %s)", async (db) => {
    const dir = repo({ Dockerfile: "FROM node:22\nEXPOSE 8080\n" });
    const result = await init({ dir, project: "shop", db, agentsFile: null });
    expect(result.files).toEqual([".spawner/spawner.yaml", ".spawner/compose.yaml"]);
    const check = checkProject((await loadWorkspace(dir))!, "main", INFO as ServerInfo, {});
    expect(check.issues).toEqual([]);
    expect(check.manifest?.exposures[0].port).toBe(8080);
    expect(check.services).toEqual(db === "none" ? ["app"] : ["app", "db"]);
  });

  it("adds the agent instructions once, after the existing content", async () => {
    const dir = repo({ "CLAUDE.md": "# Project\n", Dockerfile: "FROM x" });
    expect((await init({ dir, project: "shop", db: "postgres", agentsFile: "CLAUDE.md" })).agentsFile).toBe("CLAUDE.md");
    const again = await init({ dir, project: "shop", db: "postgres", agentsFile: "CLAUDE.md", force: true });
    expect(again.agentsFile).toBeNull();
    const content = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
    expect(content.startsWith("# Project\n\n## Preview environments (Spawner)")).toBe(true);
    expect(content.split(AGENTS_HEADING)).toHaveLength(2);
    expect(content).toContain("spawner exec <env> db -- <command>");
  });

  it("keeps existing files unless forced, and warns without a Dockerfile", async () => {
    const dir = tempDir();
    const first = await init({ dir, project: "shop", db: "none" });
    expect(first.warnings[0]).toMatch(/no Dockerfile/);
    await expect(init({ dir, project: "shop" })).rejects.toMatchObject({ code: "usage" });
  });

  it("guesses names, ports and databases", () => {
    expect(projectSlug("My_App 2")).toBe("my-app-2");
    expect(projectSlug("2048")).toBeNull();
    expect(detectPort("FROM node\nEXPOSE 4000/tcp\n")).toBe(4000);
    expect(detectPort(null)).toBe(3000);
    const node = tempDir();
    write(node, "package.json", JSON.stringify({ dependencies: { pg: "^8" } }));
    expect(detectDatabase(node)).toBe("postgres");
    const python = tempDir();
    write(python, "requirements.txt", "PyMySQL==1.1\n");
    expect(detectDatabase(python)).toBe("mysql");
  });
});
