import * as path from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { asCliError, EXIT } from "./errors";
import { Context } from "./context";
import { exec } from "./ops/exec";
import { lifecycle, list, share, stats, status, url } from "./ops/envs";
import { readJobLog, readLogs } from "./ops/logs";
import { jobExitCode, up } from "./ops/up";
import { VERSION } from "./version";

const INSTRUCTIONS = `Spawner runs preview environments of this project on a server: one per branch, built from the local worktree, with its own URLs and database.
- spawner_up creates or updates the environment of a worktree (path) and waits until it is ready; it answers its name and URLs.
- Call the URLs with the header from spawner_url (with_token: true): they are protected.
- spawner_exec runs a command in a service (the database: service "db"); spawner_logs with errors_only finds errors; spawner_status shows restarts and out-of-memory kills.
- When the work is validated, spawner_down deletes the environment.`;

const target = {
  env: z.string().optional().describe("Environment name; by default, the branch of the worktree (feat/login gives feat-login)"),
  project: z.string().optional().describe("Project slug; by default, the project of .spawner/spawner.yaml"),
  path: z.string().optional().describe("Absolute path of the worktree; by default, the directory the MCP server runs in"),
};

type Json = Record<string, unknown> | unknown[];

function json(value: Json): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/**
 * A tool error the model can act on: the message, the hint, and the end of
 * the job log when a job failed.
 */
function failure(error: unknown, logTail?: string[]): CallToolResult {
  const cliError = asCliError(error);
  const lines = [`error (${cliError.code}): ${cliError.message}`];
  if (cliError.hint) {
    lines.push(`hint: ${cliError.hint}`);
  }
  if (logTail?.length) {
    lines.push("", "end of the job log:", ...logTail);
  }
  return { isError: true, content: [{ type: "text", text: lines.join("\n") }] };
}

/**
 * The MCP server of `spawner mcp`: the operations of the CLI, run with the
 * same code and the same credentials, for agents that prefer tools to a
 * shell. The interactive terminal is not exposed: spawner_exec returns exit
 * codes an agent can use.
 */
export function createMcpServer(options: { cwd: string; env: NodeJS.ProcessEnv; fetch?: typeof fetch; context?: Context }): McpServer {
  const server = new McpServer({ name: "spawner", version: VERSION }, { instructions: INSTRUCTIONS });
  let ctx = options.context;
  const context = () => (ctx ??= new Context(options.cwd, options.env, "mcp", undefined, options.fetch));

  /**
   * The directory a tool works in: its path argument, else the first root
   * the client shares, else the server's directory.
   */
  const workdir = async (given?: string): Promise<string> => {
    if (given) {
      return path.resolve(options.cwd, given);
    }
    if (server.server.getClientCapabilities()?.roots) {
      try {
        const { roots } = await server.server.listRoots();
        const first = roots.find((root) => root.uri.startsWith("file://"));
        if (first) {
          return fileURLToPath(first.uri);
        }
      } catch {
        return options.cwd;
      }
    }
    return options.cwd;
  };

  server.registerTool(
    "spawner_up",
    {
      title: "Create or update a preview environment",
      description:
        "Builds the worktree on the Spawner server and waits until its environment is ready. Sends uncommitted changes too. Returns the environment (name, status, URLs). On failure, returns the end of the build log.",
      inputSchema: {
        path: target.path,
        env: target.env,
        sources: z.record(z.string(), z.string()).optional().describe('Other repositories of spawner.yaml to send from local worktrees: { "front": "/path/to/front" }'),
        refs: z.record(z.string(), z.string()).optional().describe('Sources to take from git at a branch instead: { "front": "develop" }'),
        fresh: z.boolean().optional().describe("Drop the data (volumes) and start from scratch"),
        reseed: z.boolean().optional().describe("Replay the seed steps of spawner.yaml"),
        ttl: z.string().optional().describe('Lifetime, such as "24h"'),
        wait: z.boolean().optional().describe("Wait until the environment is ready (default true)"),
        timeout_sec: z.number().int().positive().optional().describe("How long to wait (default 1200)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args, extra) => {
      const progressToken = extra._meta?.progressToken;
      let step = 0;
      const onProgress = (message: string) => {
        if (progressToken !== undefined) {
          void extra.sendNotification({ method: "notifications/progress", params: { progressToken, progress: ++step, message } }).catch(() => undefined);
        }
      };
      try {
        const result = await up(context(), {
          path: await workdir(args.path),
          env: args.env,
          sources: args.sources,
          refs: args.refs,
          fresh: args.fresh,
          reseed: args.reseed,
          ttl: args.ttl,
          wait: args.wait ?? true,
          timeoutSec: args.timeout_sec ?? 1200,
          onProgress,
          signal: extra.signal,
        });
        const code = jobExitCode(result);
        if (code === EXIT.ok || code === EXIT.timeout) {
          return json({ ...result, ...(code === EXIT.timeout ? { note: "still running on the server: check it with spawner_status" } : {}) });
        }
        return failure(new Error(`${result.environment.slug} failed during ${result.job.phase ?? "the job"}: ${result.job.error ?? "unknown error"}`), result.logTail);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "spawner_status",
    {
      title: "Environment status",
      description: "The environment (status, URLs, sources, expiry, last job) and its services: state, health, restarts, out-of-memory kills, exit codes.",
      inputSchema: target,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return json({ ...(await status(context(), { ...args, path: await workdir(args.path) })) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "spawner_list",
    {
      title: "List environments",
      description: "Live environments of a project (or of every project), with their owner, status and URLs.",
      inputSchema: {
        project: z.string().optional().describe("Project slug; all projects when absent"),
        mine: z.boolean().optional().describe("Only the environments of the logged-in user"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return json({ ...(await list(context(), args)) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "spawner_logs",
    {
      title: "Service logs",
      description: "Output of the services (or of the last build with job: true), merged in time order, one line per entry: '<service> | <text>'.",
      inputSchema: {
        ...target,
        service: z.string().optional().describe("Service name; all services when absent"),
        tail: z.number().int().positive().max(5000).optional().describe("Number of lines (default 200)"),
        since: z.string().optional().describe('From a duration ago ("10m") or a date'),
        grep: z.string().optional().describe("Only lines containing this text (case-insensitive)"),
        errors_only: z.boolean().optional().describe("Only lines reporting errors, with their stack traces"),
        job: z.boolean().optional().describe("The log of the last job (build, start, seed) instead"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const where = { env: args.env, project: args.project, path: await workdir(args.path) };
        if (args.job) {
          const { job, lines } = await readJobLog(context(), where);
          return { content: [{ type: "text", text: [`job ${job.id} (${job.type}, ${job.status})`, ...lines].join("\n") }] };
        }
        const { lines } = await readLogs(context(), {
          ...where,
          services: args.service ? [args.service] : undefined,
          tail: args.tail,
          since: args.since,
          grep: args.grep,
          errors: args.errors_only,
        });
        const text = lines.map((line) => `${line.service} | ${line.text}`).join("\n");
        return { content: [{ type: "text", text: text || "(no lines)" }] };
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "spawner_exec",
    {
      title: "Run a command in a service",
      description:
        'Runs a command in a running service of the environment, as an argument array (no shell unless you call one: ["sh", "-c", "..."]). Returns exitCode, stdout and stderr (1 MiB each).',
      inputSchema: {
        ...target,
        service: z.string().describe('Service name, such as "db"'),
        command: z.array(z.string()).min(1).describe('Command and arguments: ["psql", "-U", "app", "-c", "select 1"]'),
        stdin: z.string().optional().describe("Text sent to the command's standard input"),
        timeout_sec: z.number().int().positive().max(600).optional().describe("Default 120"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return json({
          ...(await exec(context(), {
            ...args,
            path: await workdir(args.path),
            argv: args.command,
            timeoutSec: args.timeout_sec,
            stdin: args.stdin === undefined ? undefined : Buffer.from(args.stdin),
          })),
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "spawner_stats",
    {
      title: "Resource usage",
      description: "CPU, memory and disk of each service right now, with restarts and out-of-memory kills.",
      inputSchema: target,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return json({ ...(await stats(context(), { ...args, path: await workdir(args.path) })) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "spawner_url",
    {
      title: "Environment URL",
      description:
        "The URL of an exposure (the entrypoint by default) and every URL of the environment. With with_token, the header (name and value, valid one hour) that lets curl, fetch or Playwright through the protection.",
      inputSchema: {
        ...target,
        exposure: z.string().optional().describe("Exposure name from spawner.yaml"),
        with_token: z.boolean().optional().describe("Also return the X-Spawner-Preview header"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return json({ ...(await url(context(), { ...args, path: await workdir(args.path), withToken: args.with_token })) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "spawner_share",
    {
      title: "Share link",
      description: "A link that opens the environment without an account, for a reviewer, until it expires.",
      inputSchema: { ...target, ttl: z.string().optional().describe('Whole hours, such as "24h" (default) or "3d"') },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        return json({ ...(await share(context(), { ...args, path: await workdir(args.path) })) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "spawner_down",
    {
      title: "Delete an environment",
      description: "Deletes the environment and everything it holds: containers, data, URLs. Use it once the work is validated.",
      inputSchema: { ...target, env: z.string().describe("Environment name, as spawner_up returned it") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const result = await lifecycle(context(), "down", { ...args, path: await workdir(args.path), wait: true });
        if (result.job.status === "failed") {
          return failure(new Error(`deleting ${args.env} failed: ${result.job.error ?? "unknown error"}`), result.logTail);
        }
        return json({ ...result });
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}

/**
 * Runs the MCP server on stdin and stdout until the client leaves.
 */
export async function serveMcp(options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<void> {
  const server = createMcpServer(options);
  const transport = new StdioServerTransport();
  const closed = new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
    process.stdin.on("end", () => resolve());
  });
  await server.connect(transport);
  await closed;
  await server.close().catch(() => undefined);
}
