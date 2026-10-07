import * as fs from "fs";
import * as path from "path";

/**
 * Total size of the regular files under a directory, symlinks not followed.
 *
 * @returns 0 when the directory does not exist
 */
export async function directorySize(dir: string): Promise<number> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(target);
    } else if (entry.isFile()) {
      total += await fs.promises
        .lstat(target)
        .then((stat) => stat.size)
        .catch(() => 0);
    }
  }
  return total;
}
