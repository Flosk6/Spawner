import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { JobLogsService } from "./job-logs.service";
import type { SpawnerConfig } from "../../common/spawner.config";
import { StorageService } from "./storage.service";

/** The lines a follower receives, without their timestamps. */
function collect(service: JobLogsService, jobId: string, isFinished: () => Promise<boolean>) {
  const lines: string[] = [];
  const done = new Promise<string[]>((resolve, reject) => {
    service.follow(jobId, isFinished).subscribe({
      next: (line) => lines.push(line.replace(/^\S+ /, "")),
      complete: () => resolve(lines),
      error: reject,
    });
  });
  return { lines, done };
}

describe("JobLogsService", () => {
  let root: string;
  let service: JobLogsService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "spawner-logs-"));
    const storage = new StorageService({ dataDir: root, keysDir: path.join(root, "keys") } as SpawnerConfig);
    storage.onModuleInit();
    service = new JobLogsService(storage);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("sends what was written, then each new line, one event per line, until the job ends", async () => {
    service.append("job", "first");
    service.append("job", "second");
    const { lines, done } = collect(service, "job", async () => false);

    service.append("job", "third");
    expect(lines).toEqual(["first", "second", "third"]);

    service.close("job");
    expect(await done).toEqual(["first", "second", "third"]);
  });

  it("ends at once for a job that is already over, even if its end was signaled before", async () => {
    service.append("job", "only line");
    service.close("job");
    const { done } = collect(service, "job", async () => true);

    expect(await done).toEqual(["only line"]);
  });

  it("keeps the log of a job readable once it ended", () => {
    service.append("job", "a");
    service.close("job");
    expect(service.read("job")).toMatch(/^\S+ a\n$/);
  });
});
