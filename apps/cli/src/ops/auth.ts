import { execFile } from "child_process";
import * as os from "os";
import type { ApiTokenInfo, CreatedToken, Scope, WhoAmI } from "@spawner/types";
import { ApiClient } from "../api";
import { credentialsPath, normalizeServer, readCredentials, writeCredentials } from "../config";
import { CliError, EXIT, usageError } from "../errors";
import { findProgram } from "../runtime";
import { Context } from "../context";

/** What the CLI shows while a login waits for approval. */
export interface DeviceCode {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

interface DeviceStart extends DeviceCode {
  deviceCode: string;
}

interface DeviceToken extends ApiTokenInfo {
  token: string;
  user: { id: number; name: string; role: string };
}

/** What `spawner login --json` prints. */
export interface LoginResult {
  server: string;
  user: { id: number; name: string; role: string };
  token: { id: string; name: string; scopes: Scope[]; expiresAt: string | null };
  credentials: string;
}

/**
 * Name of this machine for the token: "florian-mbp" for florian-mbp.local.
 */
export function machineName(hostname = os.hostname()): string {
  const name = hostname.split(".")[0].toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return (name || "cli").slice(0, 40);
}

/**
 * Logs the CLI in with a device code (RFC 8628): shows a code, waits until
 * someone approves it in the dashboard, then stores the token received in
 * the credentials file (0600).
 *
 * @param onCode - Shows the code and the approval URL
 */
export async function login(
  env: NodeJS.ProcessEnv,
  address: string,
  options: { name?: string; onCode: (code: DeviceCode) => void; signal?: AbortSignal; fetch?: typeof fetch; pollMs?: number },
): Promise<LoginResult> {
  const server = normalizeServer(address);
  const api = new ApiClient(server, null, "cli", options.fetch);
  const health = await api.raw("GET", "/healthz", { timeoutMs: 15_000 });
  if (!health.ok || ((await health.json().catch(() => null)) as { status?: string } | null)?.status !== "ok") {
    throw new CliError(`${server} is not a Spawner server (no answer on /api/v1/healthz)`, { code: "not_spawner", hint: "give the dashboard URL" });
  }

  const start = await api.post<DeviceStart>("/auth/device", { clientName: options.name ?? machineName() });
  options.onCode(start);

  let interval = (options.pollMs ?? start.interval * 1000) || 5000;
  const deadline = Date.now() + start.expiresIn * 1000;
  for (;;) {
    await delay(interval, options.signal);
    if (Date.now() > deadline) {
      throw new CliError("the code expired before it was approved", { exit: EXIT.auth, code: "expired", hint: `run spawner login ${server} again` });
    }
    const response = await api.raw("POST", "/auth/device/token", { json: { deviceCode: start.deviceCode }, signal: options.signal });
    const body = (await response.json().catch(() => ({}))) as Partial<DeviceToken> & { error?: string };
    if (response.ok && body.token) {
      const credentials = readCredentials(credentialsPath(env));
      credentials.servers[server] = {
        token: body.token,
        tokenId: body.id ?? null,
        tokenName: body.name ?? null,
        user: body.user ?? null,
        expiresAt: body.expiresAt ?? null,
        savedAt: new Date().toISOString(),
      };
      credentials.current = server;
      writeCredentials(credentialsPath(env), credentials);
      return {
        server,
        user: body.user!,
        token: { id: body.id!, name: body.name!, scopes: body.scopes ?? [], expiresAt: body.expiresAt ?? null },
        credentials: credentialsPath(env),
      };
    }
    switch (body.error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        interval += 5000;
        continue;
      case "access_denied":
        throw new CliError("the login was denied in the dashboard", { exit: EXIT.auth, code: "denied" });
      case "expired_token":
        throw new CliError("the code expired before it was approved", { exit: EXIT.auth, code: "expired", hint: `run spawner login ${server} again` });
      default:
        throw new CliError(`the login failed (${body.error ?? response.status})`, { exit: EXIT.auth, code: "login_failed", status: response.status });
    }
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new CliError("interrupted", { code: "interrupted" }));
      },
      { once: true },
    );
  });
}

/**
 * Opens a URL in the default browser, without a shell, by the absolute path
 * of the opener (see findProgram); failures are silent (the URL is printed
 * anyway).
 */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const [command, args] =
    platform === "darwin" ? ["open", [url]] : platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
  const program = findProgram(command, { platform });
  if (!program) {
    return;
  }
  const child = execFile(program, args, { timeout: 10_000 }, () => undefined);
  child.on("error", () => undefined);
  child.unref();
}

/** What `spawner whoami --json` prints. */
export interface WhoAmIResult extends WhoAmI {
  server: string;
  /** Where the token comes from: SPAWNER_TOKEN, or the credentials of spawner login. */
  source: "env" | "credentials" | "none";
  serverVersion: string;
}

export async function whoami(ctx: Context): Promise<WhoAmIResult> {
  const [who, info] = await Promise.all([ctx.api().get<WhoAmI>("/auth/whoami"), ctx.info()]);
  return { server: ctx.server!, source: ctx.source, serverVersion: info.version, ...who };
}

/**
 * Revokes the token of `spawner login` on the server and forgets it.
 */
export async function logout(ctx: Context, env: NodeJS.ProcessEnv): Promise<{ server: string; revoked: boolean }> {
  const file = credentialsPath(env);
  const credentials = readCredentials(file);
  const server = ctx.server;
  const stored = server ? credentials.servers[server] : undefined;
  if (!server || !stored) {
    throw usageError(server ? `not logged in to ${server}` : "not logged in");
  }
  let revoked = false;
  if (stored.tokenId) {
    try {
      await new ApiClient(server, stored.token, "cli").delete(`/tokens/${stored.tokenId}`);
      revoked = true;
    } catch (error) {
      if (!(error instanceof CliError) || (error.status !== 401 && error.status !== 404)) {
        throw error;
      }
    }
  }
  delete credentials.servers[server];
  if (credentials.current === server) {
    credentials.current = Object.keys(credentials.servers)[0] ?? null;
  }
  writeCredentials(file, credentials);
  return { server, revoked };
}

/**
 * Creates a personal token, for an agent or a script: at most the scopes of
 * the token that creates it.
 */
export async function createToken(
  ctx: Context,
  options: { name: string; scopes?: string[]; expiresInDays?: number; project?: string },
): Promise<CreatedToken> {
  return ctx.api().post<CreatedToken>("/tokens", { name: options.name, scopes: options.scopes, expiresInDays: options.expiresInDays, project: options.project });
}

export async function listTokens(ctx: Context, options: { all?: boolean }): Promise<{ tokens: ApiTokenInfo[] }> {
  return { tokens: await ctx.api().get<ApiTokenInfo[]>("/tokens", { all: options.all ? "true" : undefined }) };
}

/**
 * Revokes a token, named by its id or by the start of its value
 * ("spn_ab12cd34").
 */
export async function revokeToken(ctx: Context, reference: string): Promise<{ revoked: ApiTokenInfo }> {
  const { tokens } = await listTokens(ctx, { all: true }).catch(() => listTokens(ctx, {}));
  const prefix = reference.replace(/_\.\.\.$/, "");
  const token = tokens.find((candidate) => candidate.id === reference || candidate.hint.startsWith(`${prefix}_`) || candidate.hint === reference);
  if (!token) {
    throw new CliError(`no token "${reference}"`, { code: "not_found", hint: "spawner token ls lists them" });
  }
  await ctx.api().delete(`/tokens/${token.id}`);
  return { revoked: token };
}
