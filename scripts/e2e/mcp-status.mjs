#!/usr/bin/env node
// Asks `spawner mcp` for the status of an environment, as a coding agent
// would, with Node built-ins only (JSON-RPC over stdio). Fails unless the
// server lists its tools and answers that the environment is ready.
//
// Usage: node scripts/e2e/mcp-status.mjs <spawner CLI> <directory> <environment>
// The CLI finds its server in SPAWNER_URL and SPAWNER_TOKEN.

import { spawn } from "node:child_process";
import readline from "node:readline";

const [cli, directory, envName] = process.argv.slice(2);
if (!cli || !directory || !envName) {
  console.error("usage: node scripts/e2e/mcp-status.mjs <spawner CLI> <directory> <environment>");
  process.exit(2);
}

const server = spawn("node", [cli, "mcp"], { cwd: directory, stdio: ["pipe", "pipe", "inherit"] });
const pending = new Map();
let nextId = 1;
readline.createInterface({ input: server.stdout }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id !== undefined && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});

function send(method, params) {
  const id = nextId++;
  server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve) => pending.set(id, resolve));
}

function fail(message, detail) {
  console.error(`\x1b[31mFAIL: ${message}\x1b[0m`);
  console.error(JSON.stringify(detail, null, 2));
  server.kill();
  process.exit(1);
}

const init = await send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e-installer", version: "1.0.0" } });
if (init.result?.serverInfo?.name !== "spawner") {
  fail("the MCP server should answer initialize", init);
}
server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

const tools = await send("tools/list", {});
if (!tools.result?.tools?.some((tool) => tool.name === "spawner_status")) {
  fail("the MCP server should list spawner_status", tools);
}

const answer = await send("tools/call", { name: "spawner_status", arguments: { env: envName } });
const text = answer.result?.content?.map((item) => item.text).join("\n") ?? "";
let status = null;
try {
  status = JSON.parse(text).environment.status;
} catch {
  fail("spawner_status should answer JSON", answer);
}
if (status !== "ready") {
  fail(`spawner_status should say ${envName} is ready, not ${status}`, answer);
}
console.log(`\x1b[32mok\x1b[0m spawner mcp: spawner_status says ${envName} is ready`);
server.kill();
