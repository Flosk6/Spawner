import { Context } from "../context";

export interface FakeRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
  json?: any;
  form?: FormData;
}

export type Handler = (request: FakeRequest, params: Record<string, string>) => unknown;

/**
 * An answer with a status other than 200.
 */
export function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": typeof body === "string" ? "text/plain" : "application/json" },
  });
}

/**
 * A stream of server-sent events.
 */
export function events(raw: string): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(raw));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

/**
 * A fetch that answers from routes such as "GET /envs/:id" (paths after
 * /api/v1), recording every request. Plain values become JSON answers; an
 * unknown route answers 404.
 */
export function fakeFetch(routes: Record<string, Handler>, calls: FakeRequest[] = []): typeof fetch {
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const request: FakeRequest = {
      method,
      path,
      query: url.searchParams,
      headers: new Headers(init.headers),
      json: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      form: init.body instanceof FormData ? await snapshot(init.body) : undefined,
    };
    calls.push(request);
    for (const [route, handler] of Object.entries(routes)) {
      const [routeMethod, routePath] = route.split(" ");
      const params = match(routePath, path);
      if (routeMethod === method && params) {
        const result = await handler(request, params);
        return result instanceof Response ? result : new Response(result === undefined ? null : JSON.stringify(result), { status: result === undefined ? 204 : 200 });
      }
    }
    return reply(404, { statusCode: 404, message: `no route for ${method} ${path}` });
  }) as typeof fetch;
}

/**
 * Reads the files of a form while the request is sent, as a real fetch
 * does: the CLI deletes them afterwards.
 */
async function snapshot(form: FormData): Promise<FormData> {
  const copy = new FormData();
  for (const [key, value] of form.entries()) {
    copy.append(key, typeof value === "string" ? value : new Blob([await value.arrayBuffer()]));
  }
  return copy;
}

function match(pattern: string, path: string): Record<string, string> | null {
  const expected = pattern.split("/");
  const actual = path.split("/");
  if (expected.length !== actual.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let i = 0; i < expected.length; i++) {
    if (expected[i].startsWith(":")) {
      params[expected[i].slice(1)] = decodeURIComponent(actual[i]);
    } else if (expected[i] !== actual[i]) {
      return null;
    }
  }
  return params;
}

export const SERVER = "http://spawner.test";

export function fakeContext(cwd: string, fetchImpl: typeof fetch, via: "cli" | "mcp" = "cli"): Context {
  return new Context(cwd, {}, via, { server: SERVER, token: "spn_test0000_secret", source: "env" }, fetchImpl);
}

export const INFO = {
  version: "1.0.0",
  dashboardUrl: "http://spawner.localtest.me",
  previewDomain: "localtest.me",
  scheme: "http",
  limits: {
    compose: {
      envMemoryBytes: 2 * 1024 ** 3,
      envCpus: 4,
      envPids: 4096,
      serviceMemoryDefaultBytes: 512 * 1024 ** 2,
      minServiceMemoryBytes: 32 * 1024 ** 2,
      cpusDefault: 1,
      cpusMax: 2,
      pidsDefault: 512,
      pidsMax: 2048,
      shmMaxBytes: 1024 ** 3,
      stopGraceMaxSeconds: 60,
      maxServices: 30,
      envMemoryMaxBytes: 4 * 1024 ** 3,
    },
    upload: { maxBytes: 100 * 1024 ** 2, maxFiles: 50000, maxExtractedBytes: 1024 ** 3 },
    ttl: { defaultSeconds: 259200, minSeconds: 600, maxSeconds: 1209600 },
    exec: { maxSeconds: 600, maxOutputBytes: 1048576, maxStdinBytes: 1048576 },
    share: { defaultHours: 24, maxHours: 336 },
  },
};
