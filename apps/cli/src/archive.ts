import * as fs from "fs";
import * as path from "path";
import { Pack } from "tar";
import { CliError } from "./errors";
import { formatBytes } from "./format";
import { git, gitTopLevel, splitNul } from "./git";

/** The files of a source that go into its archive. */
export interface SourceFiles {
  root: string;
  /** Paths relative to root, with slashes, sorted. */
  files: string[];
  /** Total size of the regular files. */
  bytes: number;
  /** Paths left out, and why (submodules, sockets). */
  skipped: { path: string; reason: string }[];
}

/** Directories never sent unless git tracks them or upload.include names them. */
const HEAVY_DIRECTORIES = new Set(["node_modules", "vendor", ".git"]);

/** Files of credentials, by name. */
const SECRET_FILES = new Set([".npmrc", ".yarnrc.yml", ".pypirc", ".netrc", ".git-credentials", ".pgpass", ".dockercfg"]);

/** .env files, private SSH keys, and keys or certificates with their key. */
const SECRET_PATTERN = /^(?:\.env(?:[.-].+)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?|.+\.(?:pem|key|p12|pfx|jks|keystore))$/;

/**
 * Tells whether an untracked file stays home by default: dependencies
 * (node_modules, vendor) and local secrets (.env, .env.local, .env-staging,
 * .npmrc, private keys, *.pem...).
 */
export function isExcludedByDefault(file: string): boolean {
  const parts = file.split("/");
  const name = parts[parts.length - 1];
  return parts.some((part) => HEAVY_DIRECTORIES.has(part)) || SECRET_FILES.has(name) || SECRET_PATTERN.test(name);
}

/**
 * Turns a glob of upload.include into a regular expression on paths
 * relative to the project root: "*" stays within a directory, "**" crosses
 * directories, and a pattern without wildcards also matches what is under
 * it ("config/local" matches "config/local/app.php").
 */
export function globToRegExp(pattern: string): RegExp {
  const clean = pattern.replace(/^\.\//, "").replace(/\/+$/, "");
  let source = "";
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (char === "*" && clean[i + 1] === "*") {
      const slash = clean[i + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}(?:/.*)?$`);
}

/**
 * Lists the files of a source the way git sees the worktree: tracked files
 * and untracked files that are not ignored (uncommitted work included),
 * without dependencies and .env files unless tracked, plus the ignored files
 * that upload.include names. Outside git, every file but .git,
 * node_modules, vendor and .env files.
 *
 * @param root - Directory to send (the project root or a source's worktree)
 * @param include - Globs of upload.include, relative to root
 */
export async function collectFiles(root: string, include: string[] = []): Promise<SourceFiles> {
  const included = include.map(globToRegExp);
  const isIncluded = (file: string) => included.some((pattern) => pattern.test(file));
  let candidates: string[];

  if (await gitTopLevel(root)) {
    const tracked = splitNul(await git(["ls-files", "-z", "--cached"], root));
    const untracked = splitNul(await git(["ls-files", "-z", "--others", "--exclude-standard"], root));
    const ignored =
      include.length > 0
        ? splitNul(await git(["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--", ...include.map((pattern) => `:(glob)${pattern}`)], root))
        : [];
    candidates = [...tracked, ...untracked.filter((file) => !isExcludedByDefault(file) || isIncluded(file)), ...ignored.filter(isIncluded)];
  } else {
    candidates = walk(root, include).filter((file) => !isExcludedByDefault(file) || isIncluded(file));
  }

  const files: string[] = [];
  const skipped: SourceFiles["skipped"] = [];
  let bytes = 0;
  for (const file of [...new Set(candidates)].sort()) {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(path.join(root, file));
    } catch {
      continue;
    }
    if (stat.isFile()) {
      files.push(file);
      bytes += stat.size;
    } else if (stat.isSymbolicLink()) {
      files.push(file);
    } else if (stat.isDirectory()) {
      skipped.push({ path: file, reason: "git submodule (not sent)" });
    } else {
      skipped.push({ path: file, reason: "not a regular file" });
    }
  }
  return { root, files, bytes, skipped };
}

/**
 * Every file under root, for a directory outside git. Dependency
 * directories are only entered when an include pattern mentions them.
 */
function walk(root: string, include: string[]): string[] {
  const files: string[] = [];
  const visit = (relative: string) => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === ".git" || (HEAVY_DIRECTORIES.has(entry.name) && !include.some((pattern) => pattern.includes(entry.name)))) {
          continue;
        }
        visit(file);
      } else {
        files.push(file);
      }
    }
  };
  visit("");
  return files;
}

/**
 * Checks what the server would refuse before anything is sent: symlinks
 * leaving the archive, and the size and file count limits.
 *
 * @param prefix - Where the files sit in the archive ("." or "apps/api")
 */
export function checkSourceFiles(source: SourceFiles, prefix: string, limits: { maxFiles: number; maxExtractedBytes: number }, label: string): void {
  for (const file of source.files) {
    const absolute = path.join(source.root, file);
    if (!fs.lstatSync(absolute).isSymbolicLink()) {
      continue;
    }
    const target = fs.readlinkSync(absolute);
    const inArchive = path.posix.normalize(path.posix.join(path.posix.dirname(prefix === "." ? file : `${prefix}/${file}`), target.split(path.sep).join("/")));
    if (path.isAbsolute(target) || inArchive === ".." || inArchive.startsWith("../")) {
      throw new CliError(`${label}: ${file} is a symlink to ${target}, outside the repository`, {
        code: "upload_refused",
        hint: "the server refuses such links: remove it, or add it to .gitignore",
      });
    }
  }
  if (source.files.length > limits.maxFiles || source.bytes > limits.maxExtractedBytes) {
    throw new CliError(
      `${label}: ${source.files.length} files, ${formatBytes(source.bytes)}; the server accepts ${limits.maxFiles} files and ${formatBytes(limits.maxExtractedBytes)}`,
      { code: "upload_too_large", hint: `largest directories: ${largestDirectories(source).join(", ")}. Add generated files to .gitignore` },
    );
  }
}

function largestDirectories(source: SourceFiles): string[] {
  const sizes = new Map<string, number>();
  for (const file of source.files) {
    const top = file.includes("/") ? `${file.split("/")[0]}/` : file;
    try {
      sizes.set(top, (sizes.get(top) ?? 0) + fs.lstatSync(path.join(source.root, file)).size);
    } catch {
      continue;
    }
  }
  return [...sizes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, size]) => `${name} (${formatBytes(size)})`);
}

/** A hard link cache that remembers nothing: every file is stored whole. */
const NO_HARD_LINKS = { get: () => undefined, set: () => undefined } as unknown as Map<`${number}:${number}`, string>;

/**
 * Writes a gzip tar archive of the files, under prefix. The server refuses
 * hard links, so linked files are stored whole; symlinks stay symlinks;
 * ownership is left out.
 *
 * @returns The size of the archive
 */
export async function packFiles(source: SourceFiles, prefix: string, target: string): Promise<number> {
  const pack = new Pack({
    cwd: source.root,
    prefix: prefix === "." ? undefined : prefix,
    gzip: true,
    portable: true,
    noDirRecurse: true,
    follow: false,
    strict: true,
    linkCache: NO_HARD_LINKS,
  });
  const output = fs.createWriteStream(target, { mode: 0o600 });
  const written = new Promise<void>((resolve, reject) => {
    output.on("close", () => resolve());
    output.on("error", reject);
    pack.on("error", reject);
  });
  pack.pipe(output);
  for (const file of source.files) {
    pack.add(file);
  }
  pack.end();
  await written;
  return fs.statSync(target).size;
}
