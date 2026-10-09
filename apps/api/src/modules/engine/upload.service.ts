import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Parser, extract } from "tar";
import type { ReadEntry } from "tar";
import { createGunzip } from "zlib";
import { SpawnerConfig } from "../../common/spawner.config";
import { StorageService } from "./storage.service";

const ALLOWED_TYPES = new Set(["File", "OldFile", "ContiguousFile", "Directory", "SymbolicLink"]);
/** What the tar stream may hold for an entry besides its content: header, padding, extended headers. */
const ENTRY_OVERHEAD_BYTES = 4096;
/** Enough problems to refuse an archive: reading on would only lengthen the list. */
const MAX_PROBLEMS = 20;
/** Links followed at most to resolve a path, as the kernel does (ELOOP). */
const MAX_LINK_HOPS = 40;

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
 * on size and file count, checked as the archive is read so that a
 * compression bomb stops at the first limit it crosses. Extraction then goes
 * to a temporary directory, where every link is followed through the links
 * it leads to (a chain of links that each stay inside can still leave), and
 * which replaces the previous content in one rename.
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
      }).catch((error: Error) => {
        throw new UploadRejectedError([`the archive could not be extracted: ${error.message}`]);
      });
      const leaving = escapingLinks(incoming);
      if (leaving.length > 0) {
        throw new UploadRejectedError(leaving);
      }
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

  /**
   * Reads the entries of the archive without writing anything, and stops at
   * the first limit crossed: the file count, the extracted size, the size
   * of the decompressed stream (which a compression bomb can inflate without
   * entries, past the end of the archive), or 20 problems found.
   *
   * @throws UploadRejectedError when the file is not a gzip tar archive
   */
  private inspect(archivePath: string): Promise<{ problems: string[]; files: number; sizeBytes: number }> {
    const { uploadMaxFiles, uploadMaxExtractedBytes } = this.config;
    const maxStreamBytes = uploadMaxExtractedBytes + uploadMaxFiles * ENTRY_OVERHEAD_BYTES;
    return new Promise((resolve, reject) => {
      const problems: string[] = [];
      let files = 0;
      let sizeBytes = 0;
      let streamBytes = 0;
      let done = false;
      const input = fs.createReadStream(archivePath);
      const gunzip = createGunzip();
      const finish = (error?: Error) => {
        if (done) {
          return;
        }
        done = true;
        input.destroy();
        gunzip.destroy();
        if (error) {
          reject(new UploadRejectedError([`not a gzip tar archive: ${error.message}`]));
        } else {
          resolve({ problems, files, sizeBytes });
        }
      };
      const stop = (problem: string) => {
        problems.push(problem);
        finish();
      };
      const parser = new Parser({
        strict: true,
        onReadEntry: (entry) => {
          entry.resume();
          if (done) {
            return;
          }
          files++;
          sizeBytes += entry.size ?? 0;
          const problem = this.entryProblem(entry.path, entry);
          if (problem) {
            problems.push(problem);
          }
          if (files > uploadMaxFiles) {
            stop(`more than ${uploadMaxFiles} files, the most an archive may hold`);
          } else if (sizeBytes > uploadMaxExtractedBytes) {
            stop(`more than ${uploadMaxExtractedBytes} bytes once extracted, the most an archive may hold`);
          } else if (problems.length >= MAX_PROBLEMS) {
            finish();
          }
        },
      });
      parser.on("error", finish);
      parser.on("end", () => finish());
      gunzip.on("data", (chunk: Buffer) => {
        if (done) {
          return;
        }
        streamBytes += chunk.length;
        if (streamBytes > maxStreamBytes) {
          stop(`more than ${maxStreamBytes} bytes once decompressed, the most an archive may hold`);
        } else {
          parser.write(chunk);
        }
      });
      gunzip.on("end", () => parser.end());
      gunzip.on("error", finish);
      input.on("error", finish);
      input.pipe(gunzip);
    });
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

/**
 * The links under root that lead outside it once followed through every
 * link on their way, or loop.
 */
function escapingLinks(root: string): string[] {
  const realRoot = fs.realpathSync(root);
  const problems: string[] = [];
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isSymbolicLink()) {
      continue;
    }
    const link = path.join(entry.parentPath, entry.name);
    const end = followLinks(link);
    if (end === null || (end !== realRoot && !end.startsWith(`${realRoot}${path.sep}`))) {
      problems.push(`${path.relative(root, link)}: symlink leading outside the archive through other links`);
      if (problems.length >= MAX_PROBLEMS) {
        break;
      }
    }
  }
  return problems;
}

/**
 * Where a path leads once every link on the way is followed, as the kernel
 * resolves it; parts that do not exist are kept as they are. Null past 40
 * links (a loop).
 */
function followLinks(file: string): string | null {
  const pending = path.resolve(file).split(path.sep).filter(Boolean);
  let current: string = path.sep;
  let hops = 0;
  while (pending.length > 0) {
    const part = pending.shift() as string;
    if (part === ".") {
      continue;
    }
    if (part === "..") {
      current = path.dirname(current);
      continue;
    }
    const next = path.join(current, part);
    const stat = fs.lstatSync(next, { throwIfNoEntry: false });
    if (!stat?.isSymbolicLink()) {
      current = next;
      continue;
    }
    if (++hops > MAX_LINK_HOPS) {
      return null;
    }
    const target = fs.readlinkSync(next);
    pending.unshift(...target.split("/").filter(Boolean));
    if (path.isAbsolute(target)) {
      current = path.sep;
    }
  }
  return current;
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
