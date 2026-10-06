import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { extract, list } from "tar";
import type { ReadEntry } from "tar";
import { SpawnerConfig } from "./spawner.config";
import { StorageService } from "./storage.service";

const ALLOWED_TYPES = new Set(["File", "OldFile", "ContiguousFile", "Directory", "SymbolicLink"]);

/**
 * An archive refused before anything was written to disk.
 */
export class UploadRejectedError extends Error {
  constructor(readonly problems: string[]) {
    super(`archive rejected: ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? ` (+${problems.length - 5} more)` : ""}`);
    this.name = "UploadRejectedError";
  }
}

/**
 * Receives source archives sent by the CLI (gzip tar of a worktree). Every
 * entry is checked before extraction: no absolute path, no "..", no hard
 * link, device or FIFO, no symlink pointing outside the archive, and limits
 * on size and file count. Extraction then goes to a temporary directory that
 * replaces the previous content in one rename.
 */
@Injectable()
export class UploadService {
  constructor(
    private readonly config: SpawnerConfig,
    private readonly storage: StorageService,
  ) {}

  /**
   * Checks and extracts an archive into target.
   *
   * @param archivePath - Uploaded .tar.gz file
   * @param target - Directory that will hold the source
   * @returns Digest of the archive, extracted size and file count
   * @throws UploadRejectedError when the archive breaks a rule
   */
  async extract(archivePath: string, target: string): Promise<{ digest: string; sizeBytes: number; files: number }> {
    const archiveSize = fs.statSync(archivePath).size;
    if (archiveSize > this.config.uploadMaxBytes) {
      throw new UploadRejectedError([`archive is ${archiveSize} bytes, the limit is ${this.config.uploadMaxBytes}`]);
    }

    const { problems, files, sizeBytes } = await this.inspect(archivePath);
    if (problems.length > 0) {
      throw new UploadRejectedError(problems);
    }

    const suffix = randomBytes(4).toString("hex");
    const incoming = `${target}.incoming-${suffix}`;
    const previous = `${target}.previous-${suffix}`;
    fs.mkdirSync(incoming, { recursive: true });
    try {
      await extract({
        file: archivePath,
        cwd: incoming,
        strict: true,
        preservePaths: false,
        filter: (entryPath, entry) => this.entryProblem(entryPath, entry as ReadEntry) === null,
      });
      if (fs.existsSync(target)) {
        fs.renameSync(target, previous);
      }
      fs.renameSync(incoming, target);
    } finally {
      fs.rmSync(incoming, { recursive: true, force: true });
      await this.storage.removeTree(previous);
    }

    return { digest: await sha256(archivePath), sizeBytes, files };
  }

  private async inspect(archivePath: string): Promise<{ problems: string[]; files: number; sizeBytes: number }> {
    const problems: string[] = [];
    let files = 0;
    let sizeBytes = 0;
    await list({
      file: archivePath,
      strict: true,
      onReadEntry: (entry) => {
        files++;
        sizeBytes += entry.size ?? 0;
        const problem = this.entryProblem(entry.path, entry);
        if (problem) {
          problems.push(problem);
        }
      },
    });
    if (files > this.config.uploadMaxFiles) {
      problems.push(`${files} files, the limit is ${this.config.uploadMaxFiles}`);
    }
    if (sizeBytes > this.config.uploadMaxExtractedBytes) {
      problems.push(`${sizeBytes} bytes once extracted, the limit is ${this.config.uploadMaxExtractedBytes}`);
    }
    return { problems, files, sizeBytes };
  }

  private entryProblem(entryPath: string, entry: ReadEntry): string | null {
    const normalized = entryPath.replace(/\\/g, "/");
    if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
      return `${entryPath}: absolute path`;
    }
    if (normalized.split("/").includes("..")) {
      return `${entryPath}: ".." in path`;
    }
    if (!ALLOWED_TYPES.has(entry.type)) {
      return `${entryPath}: ${entry.type} entries are not allowed`;
    }
    if (entry.type === "SymbolicLink") {
      const link = entry.linkpath ?? "";
      if (link.startsWith("/")) {
        return `${entryPath}: symlink to an absolute path`;
      }
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(normalized), link));
      if (resolved === ".." || resolved.startsWith("../")) {
        return `${entryPath}: symlink pointing outside the archive`;
      }
    }
    return null;
  }
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    fs.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}
