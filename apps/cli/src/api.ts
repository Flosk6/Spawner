import { CliError, EXIT, type CliErrorOptions } from "./errors";
import { VERSION } from "./version";

type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  query?: Query;
  json?: unknown;
  form?: FormData;
  accept?: string;
  signal?: AbortSignal;
  /** Milliseconds before giving up (60 s by default; uploads take longer). */
  timeoutMs?: number;
}

/** A server-sent event. */
export interface ServerEvent {
  event: string;
  data: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Client of the Spawner API (/api/v1). Every request carries the
 * X-Spawner-Client header and, when there is one, the bearer token; every
 * failure becomes a CliError with the exit code it deserves.
 */
export class ApiClient {
  private readonly fetch: typeof fetch;

  constructor(
    readonly server: string,
    private readonly token: string | null,
    private readonly client: "cli" | "mcp" = "cli",
    fetchImpl?: typeof fetch,
  ) {
    this.fetch = fetchImpl ?? globalThis.fetch;
  }

  get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  post<T>(path: string, json?: unknown): Promise<T> {
    return this.request<T>("POST", path, { json: json ?? {} });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  async text(path: string, query?: Query): Promise<string> {
    const response = await this.send("GET", path, { query, accept: "text/plain" });
    return response.text();
  }

  /**
   * Sends a request and decodes its JSON answer (undefined for a 204).
   */
  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.send(method, path, options);
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /**
   * Sends a request and returns the answer as is when it is a success.
   */
  async send(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
    const response = await this.raw(method, path, options);
    if (!response.ok) {
      throw await this.failure(response);
    }
    return response;
  }

  /**
   * Sends a request and returns the answer whatever its status; only network
   * failures throw.
   */
  async raw(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: options.accept ?? "application/json",
      "User-Agent": `spawner-cli/${VERSION} node/${process.versions.node}`,
      "X-Spawner-Client": this.client,
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    let body: RequestInit["body"] | undefined;
    if (options.form) {
      body = options.form;
    } else if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    }
    const signals = [AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS), ...(options.signal ? [options.signal] : [])];
    try {
      return await this.fetch(this.url(path, options.query), { method, headers, body, signal: anySignal(signals) });
    } catch (error) {
      throw this.networkFailure(error, options.signal);
    }
  }

  /**
   * Reads a stream of server-sent events, until the server ends it or the
   * signal aborts. Comments (keep-alives) are skipped.
   */
  async *events(path: string, query?: Query, signal?: AbortSignal): AsyncGenerator<ServerEvent> {
    const response = await this.send("GET", path, { query, accept: "text/event-stream", signal, timeoutMs: 2 ** 31 - 1 });
    if (!response.body) {
      return;
    }
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n?/g, "\n");
        let index: number;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const event = parseServerEvent(buffer.slice(0, index));
          buffer = buffer.slice(index + 2);
          if (event) {
            yield event;
          }
        }
      }
    } catch (error) {
      if (signal?.aborted) {
        return;
      }
      throw this.networkFailure(error, signal);
    }
  }

  url(path: string, query?: Query): string {
    const url = new URL(`${this.server}/api/v1${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private networkFailure(error: unknown, signal?: AbortSignal): CliError {
    if (signal?.aborted) {
      return new CliError("interrupted", { code: "interrupted" });
    }
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    if ((error as Error).name === "TimeoutError") {
      return new CliError(`${this.server} did not answer in time`, { exit: EXIT.timeout, code: "timeout" });
    }
    return new CliError(`cannot reach ${this.server}: ${cause?.code ?? cause?.message ?? (error as Error).message}`, {
      code: "network",
      hint: "check the address (spawner whoami shows it) and your connection",
    });
  }

  private async failure(response: Response): Promise<CliError> {
    let body: unknown = null;
    const text = await response.text().catch(() => "");
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const fields = (body ?? {}) as { message?: unknown; error?: unknown; code?: unknown; hint?: unknown };
    const message = Array.isArray(fields.message)
      ? fields.message.join("; ")
      : typeof fields.message === "string"
        ? fields.message
        : typeof fields.error === "string"
          ? fields.error
          : text.slice(0, 200) || response.statusText;
    const limit =
      fields.code === "quota" || fields.code === "capacity"
        ? { exit: EXIT.capacity, code: fields.code, ...(typeof fields.hint === "string" ? { hint: fields.hint } : {}) }
        : {};
    return new CliError(message, {
      ...describeStatus(response.status, this.server, Boolean(this.token)),
      ...limit,
      status: response.status,
      details: body && typeof body === "object" ? { body } : undefined,
    });
  }
}

/**
 * A signal that aborts with the first of several (AbortSignal.any appeared
 * in Node.js 20.3).
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(signals);
  }
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

/**
 * The code, exit code and hint of an API error status.
 */
function describeStatus(status: number, server: string, withToken: boolean): CliErrorOptions {
  switch (status) {
    case 401:
      return {
        exit: EXIT.auth,
        code: withToken ? "unauthorized" : "not_logged_in",
        hint: withToken ? `the token is invalid, expired or revoked: run spawner login ${server}` : `run: spawner login ${server}`,
      };
    case 403:
      return { exit: EXIT.auth, code: "forbidden" };
    case 404:
      return { code: "not_found" };
    case 409:
      return { code: "conflict" };
    case 413:
      return { code: "too_large", hint: "the upload is larger than the server accepts: add generated files to .gitignore" };
    case 429:
      return { code: "rate_limited", hint: "too many requests: wait a few seconds and retry" };
    default:
      return status >= 500 ? { code: "server_error", hint: "the server failed: its logs (docker logs spawner) say why" } : { code: "bad_request" };
  }
}

/**
 * Parses one server-sent event ("event:" and "data:" lines).
 *
 * @returns The event, or null for a comment
 */
export function parseServerEvent(raw: string): ServerEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line === "" || line.startsWith(":")) {
      continue;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") {
      event = value;
    } else if (field === "data") {
      data.push(value);
    }
  }
  return data.length === 0 && event === "message" ? null : { event, data: data.join("\n") };
}
