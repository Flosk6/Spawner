import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CliError, EXIT, usageError } from "./errors";

/** What `spawner login` stored for one server. */
export interface StoredServer {
  token: string;
  tokenId: string | null;
  tokenName: string | null;
  user: { id: number; name: string; role: string } | null;
  expiresAt: string | null;
  savedAt: string;
}

export interface Credentials {
  version: 1;
  /** Server the commands talk to, the last one logged in to. */
  current: string | null;
  servers: Record<string, StoredServer>;
}

/**
 * Directory of the CLI's files: $XDG_CONFIG_HOME/spawner, ~/.config/spawner,
 * or %APPDATA%\spawner on Windows.
 */
export function configDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = os.homedir()): string {
  if (env.SPAWNER_CONFIG_DIR) {
    return env.SPAWNER_CONFIG_DIR;
  }
  if (env.XDG_CONFIG_HOME) {
    return path.join(env.XDG_CONFIG_HOME, "spawner");
  }
  if (platform === "win32" && env.APPDATA) {
    return path.join(env.APPDATA, "spawner");
  }
  return path.join(home, ".config", "spawner");
}

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(configDir(env), "credentials.json");
}

export function readCredentials(file: string): Credentials {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { version: 1, current: null, servers: {} };
  }
  try {
    const parsed = JSON.parse(text) as Partial<Credentials>;
    return { version: 1, current: parsed.current ?? null, servers: parsed.servers ?? {} };
  } catch {
    throw new CliError(`${file} is not valid JSON`, { code: "config_invalid", hint: "delete it and log in again (spawner login <url>)" });
  }
}

/**
 * Writes the credentials, readable by their owner only (0600, directory
 * 0700), through a temporary file so a crash never leaves half a file.
 */
export function writeCredentials(file: string, credentials: Credentials): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

/**
 * Normalizes the address of a Spawner server to its origin:
 * "spawner.example.com" becomes "https://spawner.example.com".
 */
export function normalizeServer(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw usageError(`"${input}" is not a server address`, "give the dashboard URL, such as https://spawner.preview.example.com");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw usageError(`"${input}" is not an http(s) address`);
  }
  return url.origin;
}

/** The server and token a command uses, and where they come from. */
export interface Connection {
  server: string | null;
  token: string | null;
  source: "env" | "credentials" | "none";
}

/**
 * SPAWNER_URL and SPAWNER_TOKEN win over the credentials of `spawner login`,
 * so that CI jobs and agents in containers need no login.
 */
export function resolveConnection(env: NodeJS.ProcessEnv, credentials: Credentials): Connection {
  const server = env.SPAWNER_URL ? normalizeServer(env.SPAWNER_URL) : credentials.current;
  if (env.SPAWNER_TOKEN) {
    return { server, token: env.SPAWNER_TOKEN, source: "env" };
  }
  const stored = server ? credentials.servers[server] : undefined;
  return stored ? { server, token: stored.token, source: "credentials" } : { server, token: null, source: "none" };
}

export function notLoggedIn(server: string | null): CliError {
  return new CliError(server ? `not logged in to ${server}` : "not logged in", {
    exit: EXIT.auth,
    code: "not_logged_in",
    hint: `run: spawner login ${server ?? "<dashboard url>"} (or set SPAWNER_URL and SPAWNER_TOKEN)`,
  });
}
