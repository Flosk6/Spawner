import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { gzipSync } from "zlib";
import type { SpawnerConfig } from "../../common/spawner.config";
import { StorageService } from "./storage.service";
import { UploadRejectedError, UploadService } from "./upload.service";

interface Entry {
  name: string;
  type?: "0" | "1" | "2" | "3" | "5" | "6";
  content?: string;
  linkname?: string;
}

/**
 * Writes a gzip tar archive entry by entry, so tests can produce what a
 * well-behaved tar tool would refuse to create (absolute paths, "..",
 * devices).
 */
function archive(entries: Entry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content ?? "");
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, "utf8");
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, "0")}\0`, 136);
    header.write("        ", 148);
    header.write(entry.type ?? "0", 156);
    header.write(entry.linkname ?? "", 157, 100, "utf8");
    header.write("ustar\0", 257);
    header.write("00", 263);
    let checksum = 0;
    for (const byte of header) {
      checksum += byte;
    }
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(header, content, Buffer.alloc((512 - (content.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

describe("UploadService", () => {
  let dir: string;
  let target: string;
  let service: UploadService;

  const config = { uploadMaxBytes: 1024 * 1024, uploadMaxFiles: 50, uploadMaxExtractedBytes: 1024 * 1024 } as SpawnerConfig;

  function write(entries: Entry[]): string {
    const file = path.join(dir, `archive-${Math.random()}.tar.gz`);
    fs.writeFileSync(file, archive(entries));
    return file;
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "spawner-upload-"));
    target = path.join(dir, "src", "app");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    service = new UploadService(config, new StorageService(config));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("extracts files, directories and links that stay inside", async () => {
    const result = await service.extract(
      write([
        { name: "app/", type: "5" },
        { name: "app/index.js", content: "console.log(1)\n" },
        { name: ".spawner/compose.yaml", content: "services: {}\n" },
        { name: "app/current", type: "2", linkname: "index.js" },
      ]),
      target,
    );

    expect(result.files).toBe(4);
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readFileSync(path.join(target, "app", "index.js"), "utf8")).toBe("console.log(1)\n");
    expect(fs.readlinkSync(path.join(target, "app", "current"))).toBe("index.js");
  });

  it("replaces the previous content of the source", async () => {
    await service.extract(write([{ name: "old.txt", content: "old" }]), target);
    await service.extract(write([{ name: "new.txt", content: "new" }]), target);

    expect(fs.readdirSync(target)).toEqual(["new.txt"]);
    expect(fs.readdirSync(path.dirname(target))).toEqual(["app"]);
  });

  it.each([
    ["an absolute path", { name: "/etc/cron.d/pwned", content: "x" }],
    ["a path with ..", { name: "app/../../../../tmp/pwned", content: "x" }],
    ["a symlink to an absolute path", { name: "app/etc", type: "2", linkname: "/etc" }],
    ["a symlink escaping the archive", { name: "app/up", type: "2", linkname: "../../../outside" }],
    ["a hard link", { name: "app/passwd", type: "1", linkname: "etc/passwd" }],
    ["a character device", { name: "app/null", type: "3" }],
    ["a FIFO", { name: "app/fifo", type: "6" }],
  ] as [string, Entry][])("rejects %s without writing anything", async (_label, entry) => {
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "kept.txt"), "kept");

    await expect(service.extract(write([{ name: "ok.txt", content: "ok" }, entry]), target)).rejects.toBeInstanceOf(UploadRejectedError);

    expect(fs.readdirSync(target)).toEqual(["kept.txt"]);
    expect(fs.existsSync("/tmp/pwned")).toBe(false);
    expect(fs.readdirSync(path.dirname(target))).toEqual(["app"]);
  });

  it("rejects archives with too many files", async () => {
    const entries = Array.from({ length: 51 }, (_, index) => ({ name: `f${index}.txt`, content: "x" }));
    await expect(service.extract(write(entries), target)).rejects.toThrow(/51 files, the limit is 50/);
  });

  it("rejects archives that expand beyond the limit", async () => {
    const big = "a".repeat(600 * 1024);
    await expect(service.extract(write([{ name: "a", content: big }, { name: "b", content: big }]), target)).rejects.toThrow(/once extracted/);
  });
});
