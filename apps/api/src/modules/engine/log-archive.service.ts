import { Injectable } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { gunzipSync, gzipSync } from "zlib";
import type { RawLogLine } from "../../common/docker-logs";
import { DockerService } from "../../common/docker.service";
import { StorageService } from "./storage.service";

/** What is kept of each service: its last MiB of output. */
const ARCHIVE_BYTES = 1024 * 1024;
const SCAN_LINES = 20_000;
const SUFFIX = ".jsonl.gz";

/**
 * Keeps the last logs of an environment's services once it is deleted, so
 * that what happened can be understood afterwards: the last MiB of each
 * service, compressed, in archives/<environment>/<service>.jsonl.gz, kept 7
 * days with the environment's timeline.
 */
@Injectable()
export class LogArchiveService {
  constructor(
    private readonly docker: DockerService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Archives the output of every container of the environment.
   *
   * @returns The services archived
   */
  async archive(environmentId: string): Promise<string[]> {
    const containers = await this.docker.listEnvironmentContainers(environmentId);
    const dir = this.storage.archiveDir(environmentId);
    fs.mkdirSync(dir, { recursive: true });
    const archived: string[] = [];
    for (const container of containers) {
      const service = container.Labels["com.docker.compose.service"];
      if (!service || !/^[\w.-]+$/.test(service)) {
        continue;
      }
      const lines = await this.docker.logLines(container.Id, { tail: SCAN_LINES }).catch(() => [] as RawLogLine[]);
      fs.writeFileSync(path.join(dir, `${service}${SUFFIX}`), gzipSync(lastBytes(lines, ARCHIVE_BYTES)), { mode: 0o600 });
      archived.push(service);
    }
    return archived;
  }

  /**
   * The archived lines of a deleted environment, service by service.
   */
  read(environmentId: string): { service: string; line: RawLogLine }[] {
    const dir = this.storage.archiveDir(environmentId);
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((file) => file.endsWith(SUFFIX));
    } catch {
      return [];
    }
    return files.flatMap((file) => {
      const service = file.slice(0, -SUFFIX.length);
      try {
        return gunzipSync(fs.readFileSync(path.join(dir, file)))
          .toString("utf8")
          .split("\n")
          .filter(Boolean)
          .map((json) => ({ service, line: JSON.parse(json) as RawLogLine }));
      } catch {
        return [];
      }
    });
  }
}

/**
 * The newest lines that fit in a number of bytes, as JSON lines.
 */
export function lastBytes(lines: RawLogLine[], max: number): string {
  const kept: string[] = [];
  let size = 0;
  for (let index = lines.length - 1; index >= 0; index--) {
    const json = JSON.stringify(lines[index]);
    size += Buffer.byteLength(json) + 1;
    if (size > max) {
      break;
    }
    kept.unshift(json);
  }
  return kept.join("\n");
}
