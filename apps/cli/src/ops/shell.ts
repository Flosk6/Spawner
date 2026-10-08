import { StringDecoder } from "string_decoder";
import { chunkTerminalInput } from "@spawner/core";
import { io } from "socket.io-client";
import { CliError, EXIT, usageError } from "../errors";
import { Context, ensureAwake, findEnvironment, resolveTarget, type TargetOptions } from "../context";

interface Terminal {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
}

/**
 * Opens an interactive terminal in a service, through the terminal
 * WebSocket of the dashboard: the same sessions as the browser terminal,
 * with the same rights (envs:exec, the owner or an admin) and audit. What
 * is typed goes in pieces the server accepts, a large paste included, and a
 * character read in two halves is sent whole.
 *
 * @returns The exit code of the shell
 */
export async function shell(ctx: Context, options: TargetOptions & { service: string; onProgress?: (message: string) => void }, terminal: Terminal): Promise<number> {
  if (!terminal.stdin.isTTY || !terminal.stdout.isTTY) {
    throw usageError("spawner shell needs a terminal", "agents and scripts use: spawner exec <env> <service> -- <command>");
  }
  const environment = await ensureAwake(ctx, await findEnvironment(ctx, await resolveTarget(ctx, options)), options.onProgress);
  const api = ctx.api();
  const { ticket } = await api.post<{ ticket: string }>("/auth/ws-ticket");

  const socket = io(`${api.server}/terminal`, {
    transports: ["websocket"],
    query: { token: ticket },
    reconnection: false,
    extraHeaders: { "User-Agent": "spawner-cli" },
  });

  return new Promise<number>((resolve, reject) => {
    let started = false;
    let settled = false;
    const settle = (settleWith: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      settleWith();
      terminal.stdin.setRawMode(false);
      terminal.stdin.pause();
      terminal.stdin.off("data", onInput);
      terminal.stdout.off("resize", onResize);
      socket.close();
    };
    const finish = (code: number) => settle(() => resolve(code));
    const fail = (message: string) =>
      settle(() => reject(new CliError(message, { exit: /unauthor|ticket|owner|scope/i.test(message) ? EXIT.auth : EXIT.error, code: "terminal" })));
    const decoder = new StringDecoder("utf8");
    const onInput = (chunk: Buffer) => {
      for (const input of chunkTerminalInput(decoder.write(chunk))) {
        socket.emit("terminal-input", { input, resourceName: options.service });
      }
    };
    const onResize = () => socket.emit("terminal-resize", { resourceName: options.service, cols: terminal.stdout.columns, rows: terminal.stdout.rows });

    socket.on("connect", () => {
      socket.emit("start-terminal", { environmentId: environment.id, resourceName: options.service, cols: terminal.stdout.columns, rows: terminal.stdout.rows });
    });
    socket.on("terminal-output", (data: string) => {
      if (!started) {
        started = true;
        terminal.stdin.setRawMode(true);
        terminal.stdin.resume();
        terminal.stdin.on("data", onInput);
        terminal.stdout.on("resize", onResize);
      }
      terminal.stdout.write(data);
    });
    socket.on("terminal-exit", (code: number) => finish(typeof code === "number" ? code : 0));
    socket.on("terminal-error", (message: string) => fail(message));
    socket.on("connect_error", (error: Error) => fail(`cannot open the terminal: ${error.message}`));
    socket.on("disconnect", (reason: string) => (started ? finish(0) : fail(`the server closed the connection (${reason})`)));
  });
}
