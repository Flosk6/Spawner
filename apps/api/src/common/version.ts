import * as fs from "fs";
import * as path from "path";

/**
 * Version of this Spawner: SPAWNER_VERSION, set by the release build from its
 * tag, or the API's package.json (next to dist/ in development and in the
 * image).
 */
function readVersion(): string {
  if (process.env.SPAWNER_VERSION) {
    return process.env.SPAWNER_VERSION;
  }
  try {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "..", "package.json"), "utf8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export const SPAWNER_VERSION = readVersion();
