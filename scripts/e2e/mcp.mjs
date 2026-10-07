#!/usr/bin/env node
// Plays a coding agent that uses `spawner mcp` for scripts/e2e-engine.sh,
// with Node built-ins only (JSON-RPC over stdio): lists the tools, reads the
// environment of the worktree, calls its protected URL with the preview
// header, breaks the database and finds the error in the logs, redeploys
// with progress notifications, then deletes the environment. Fails with a
// message on the first unexpected answer.
//
// Usage: node scripts/e2e/mcp.mjs <spawner CLI> <worktree> <environment>
// Environment: SPAWNER_HTTP (http://127.0.0.1:80, where Traefik listens), and
//              the CLI's own (SPAWNER_CONFIG_DIR...)

import { spawn } from "node:child_process";
import http from "node:http";
import readline from "node:readline";

const TRAEFIK = process.env.SPAWNER_HTTP ?? "http://127.0.0.1:80";
const [cli, worktree, envName] = process.argv.slice(2);
if (!cli || !worktree || !envName) {
  console.error("usage: node scripts/e2e/mcp.mjs <spawner CLI> <worktree> <environment>");
  process.exit(2);
}

const ok = (message) => console.log(`\x1b[32mok\x1b[0m ${message}`);
function expect(condition, message, detail) {
  if (!condition) {
    console.error(`\x1b[31mFAIL: ${message}\x1b[0m`);
    if (detail !== undefined) {
      console.error(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2));
    }
    server.kill();
    process.exit(1);
  }
}

const server = spawn("node", [cli, "mcp"], { cwd: worktree, stdio: ["pipe", "pipe", "inherit"] });
const pending = new Map();
const progress = [];
let nextId = 1;
readline.createInterface({ input: server.stdout }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "notifications/progress") {
    progress.push(message.params.message);
  } else if (message.id !== undefined && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});

function send(method, params, extra = {}) {
  const id = nextId++;
  server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params, ...extra })}\n`);
  return new Promise((resolve) => pending.set(id, resolve));
}

async function call(name, args = {}, meta) {
  const answer = await send("tools/call", { name, arguments: args, ...(meta ? { _meta: meta } : {}) });
  expect(!answer.error, `${name} answered`, answer);
  const text = answer.result.content.map((item) => item.text).join("\n");
  return { error: answer.result.isError === true, text, json: answer.result.isError ? null : tryJson(text) };
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** A request through Traefik, as an agent with curl. */
function get(url, headers = {}) {
  const target = new URL(url);
  const base = new URL(TRAEFIK);
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: base.hostname, port: base.port, path: target.pathname, headers: { host: target.host, ...headers } }, (res) => {
        let text = "";
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode, text }));
      })
      .on("error", reject);
  });
}

const init = await send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e-agent", version: "1.0.0" } });
expect(init.result?.serverInfo?.name === "spawner", "the MCP server answers initialize", init);
server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

const { result } = await send("tools/list", {});
const names = result.tools.map((tool) => tool.name).sort();
expect(names.length === 9 && names.includes("spawner_up") && names.includes("spawner_exec"), "the server lists the nine tools", names);
expect(result.tools.find((tool) => tool.name === "spawner_down").annotations.destructiveHint === true, "spawner_down asks for confirmation");
ok(`the MCP server lists ${names.join(", ")}`);

const status = await call("spawner_status");
expect(status.json?.environment?.slug === envName && status.json.environment.status === "ready", "spawner_status finds the environment of the branch", status.text);
expect(status.json.services.some((service) => service.name === "db" && service.health === "healthy"), "spawner_status shows the health of the services", status.json.services);
ok("spawner_status: the environment of the worktree's branch, its services healthy");

const url = await call("spawner_url", { with_token: true });
expect(url.json?.header?.name === "X-Spawner-Preview", "spawner_url gives the preview header", url.text);
const page = await get(url.json.url, { [url.json.header.name]: url.json.header.value });
expect(page.status === 200 && page.text.includes("user(s)"), "the header opens the protected URL", page);
const refused = await get(url.json.url, { accept: "application/json" });
expect(refused.status === 401, "without the header, the URL stays closed", refused);
ok("spawner_url: the agent calls the protected URL with its header");

const broken = await call("spawner_exec", { service: "db", command: ["psql", "-U", "app", "-d", "app", "-c", "ALTER TABLE users RENAME TO people"] });
expect(broken.json?.exitCode === 0, "spawner_exec runs psql", broken.text);
const failing = await get(`${url.json.url}/users`, { [url.json.header.name]: url.json.header.value });
expect(failing.status === 500, "the API fails without its table", failing);
const errors = await call("spawner_logs", { service: "app", errors_only: true, tail: 20 });
expect(errors.text.includes('relation "users" does not exist'), "spawner_logs finds the error", errors.text);
await call("spawner_exec", { service: "db", command: ["psql", "-U", "app", "-d", "app", "-c", "ALTER TABLE people RENAME TO users"] });
ok("spawner_exec and spawner_logs: the agent finds why the API fails, and fixes it");

const updated = await call("spawner_up", {}, { progressToken: "up" });
expect(!updated.error && updated.json?.action === "updated" && updated.json.environment.status === "ready", "spawner_up redeploys", updated.text);
expect(progress.some((message) => message.startsWith("Packing")) && progress.some((message) => message.startsWith("Ready in")), "spawner_up reports its progress", progress);
ok(`spawner_up: redeployed, with ${progress.length} progress notifications`);

const deleted = await call("spawner_down", { env: envName });
expect(!deleted.error && deleted.json?.job?.status === "succeeded", "spawner_down deletes the environment", deleted.text);
ok("spawner_down: the environment is gone");

server.stdin.end();
