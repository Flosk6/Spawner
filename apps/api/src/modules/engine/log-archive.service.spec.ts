import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import type { RawLogLine } from "../../common/docker-logs";
import type { DockerService } from "../../common/docker.service";
import { LogArchiveService, lastBytes } from "./log-archive.service";
import type { StorageService } from "./storage.service";

const line = (second: number, text: string): RawLogLine => ({ stream: "stdout", time: `2026-10-07T10:00:${String(second).padStart(2, "0")}.000000000Z`, text });

describe("LogArchiveService", () => {
  it("keeps the newest lines that fit", () => {
    const size = (entry: RawLogLine) => JSON.stringify(entry).length + 1;
    const kept = lastBytes([line(1, "old"), line(2, "middle"), line(3, "new")], size(line(2, "middle")) + size(line(3, "new")));
    expect(kept.split("\n").map((json) => JSON.parse(json).text)).toEqual(["middle", "new"]);
  });

  it("archives each service's output and reads it back once the containers are gone", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "archives-"));
    const storage = { archiveDir: (id: string) => path.join(root, id) } as StorageService;
    const docker = {
      listEnvironmentContainers: async () => [
        { Id: "c1", Labels: { "com.docker.compose.service": "api" } },
        { Id: "c2", Labels: { "com.docker.compose.service": "../escape" } },
      ],
      logLines: async () => [line(1, "listening"), line(2, "Error: boom")],
    } as unknown as DockerService;
    const archives = new LogArchiveService(docker, storage);
    expect(await archives.archive("env-1")).toEqual(["api"]);
    expect(archives.read("env-1")).toEqual([
      { service: "api", line: line(1, "listening") },
      { service: "api", line: line(2, "Error: boom") },
    ]);
    expect(archives.read("unknown")).toEqual([]);
  });
});
