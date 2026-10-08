import * as path from "path";
import * as readline from "readline";
import { parseDuration } from "@spawner/core";
import type { LogLine } from "@spawner/types";
import { Command, CommanderError, Option } from "commander";
import { Context } from "./context";
import { asCliError, CliError, EXIT, usageError } from "./errors";
import { formatBytes, relativeTime, table } from "./format";
import { serveMcp } from "./mcp";
import { createToken, listTokens, login, logout, openBrowser, revokeToken, whoami } from "./ops/auth";
import { exec } from "./ops/exec";
import { capacity, extend, lifecycle, list, share, stats, status, url } from "./ops/envs";
import { defaultAgentsFile, init, type Database } from "./ops/init";
import { followJobLog, followLogs, readJobLog, readLogs } from "./ops/logs";
import { shell } from "./ops/shell";
import { jobExitCode, up } from "./ops/up";
import { Output } from "./output";
import { renderCapacity, renderList, renderStatus, renderUsage, urlLines } from "./render";
import { ensureAwake, findEnvironment, resolveTarget } from "./context";
import { loadWorkspace, manifestProject } from "./workspace";
import { VERSION } from "./version";

export interface Io {
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
  stdin: NodeJS.ReadStream;
  env: NodeJS.ProcessEnv;
  cwd: string;
}

interface Setup {
  output: Output;
  cwd: string;
  ctx: () => Context;
}

interface Globals {
  json?: boolean;
  quiet?: boolean;
  dir?: string;
  project?: string;
}

/**
 * Collects a repeated option: --source front=../front --source admin=../admin.
 */
function keyValue(value: string, previous: Record<string, string> = {}): Record<string, string> {
  const index = value.indexOf("=");
  if (index <= 0 || index === value.length - 1) {
    throw usageError(`"${value}" should be <name>=<value>`);
  }
  return { ...previous, [value.slice(0, index)]: value.slice(index + 1) };
}

function seconds(value: string): number {
  const parsed = /^\d+$/.test(value) ? Number(value) : parseDuration(value);
  if (parsed === null || parsed <= 0) {
    throw usageError(`"${value}" is not a duration (such as 90, 10m or 2h)`);
  }
  return Math.round(parsed);
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw usageError(`"${value}" is not a positive whole number`);
  }
  return parsed;
}

/**
 * Aborts on Ctrl-C, so that waits and streams end cleanly.
 */
function interruptSignal(): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.once("SIGINT", onSigint);
  return { signal: controller.signal, dispose: () => process.off("SIGINT", onSigint) };
}

function ask(io: Io, question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: io.stdin, output: io.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(!/^n/i.test(answer.trim()));
    });
  });
}

/**
 * The spawner command and its subcommands. Every action sets the exit code
 * through setExit instead of exiting, so that output is flushed.
 */
export function buildProgram(io: Io, setExit: (code: number) => void): Command {
  const program = new Command("spawner")
    .description("Preview environments of your branches and worktrees, on your own server")
    .version(VERSION, "-v, --version")
    .option("--json", "print a JSON result on stdout (errors too)")
    .option("-q, --quiet", "no progress messages")
    .option("-C, --dir <dir>", "run as if started in <dir>")
    .showHelpAfterError("(spawner --help lists the commands)")
    .exitOverride()
    .configureOutput({ writeOut: (text) => io.stdout.write(text), writeErr: (text) => io.stderr.write(text) });

  const setup = (command: Command): Setup => {
    const globals = command.optsWithGlobals<Globals>();
    const output = new Output(Boolean(globals.json), io, io.env, Boolean(globals.quiet));
    const cwd = globals.dir ? path.resolve(io.cwd, globals.dir) : io.cwd;
    return { output, cwd, ctx: () => new Context(cwd, io.env, "cli") };
  };

  /**
   * Wraps an action: it receives the output and context first, then the
   * arguments and options of the command; errors become a message (or a
   * JSON error) and an exit code.
   */
  const run =
    (handler: (setup: Setup, ...args: any[]) => Promise<number | void>) =>
    async (...args: unknown[]) => {
      const command = args[args.length - 1] as Command;
      const env = setup(command);
      try {
        setExit((await handler(env, ...args.slice(0, -1))) ?? EXIT.ok);
      } catch (error) {
        const failure = asCliError(error);
        env.output.error(failure);
        setExit(failure.exit);
      }
    };

  const projectOption = () => new Option("-p, --project <slug>", "project (default: from .spawner/spawner.yaml)");

  program
    .command("login")
    .description("log in to a Spawner server (enter the code it shows in the dashboard)")
    .argument("[url]", "dashboard URL, such as https://spawner.preview.example.com")
    .option("--name <name>", "name of the token, shown on your environments (default: this machine)")
    .option("--no-browser", "do not open the browser")
    .action(
      run(async ({ output }, address: string | undefined, options: { name?: string; browser: boolean }) => {
        const server = address ?? io.env.SPAWNER_URL ?? new Context(io.cwd, io.env, "cli").server;
        if (!server) {
          throw usageError("which server?", "spawner login <dashboard url>");
        }
        const interrupt = interruptSignal();
        try {
          const result = await login(io.env, server, {
            name: options.name,
            signal: interrupt.signal,
            onCode: (code) => {
              output.stderr(`Open ${output.err.cyan(code.verificationUri)}`);
              output.stderr(`and enter the code ${output.err.bold(code.userCode)} (it expires in ${Math.round(code.expiresIn / 60)} minutes).`);
              if (options.browser && output.interactive) {
                openBrowser(code.verificationUri);
              }
              output.stderr(output.err.dim("Waiting for approval..."));
            },
          });
          if (output.json) {
            output.data(result);
            return;
          }
          output.print(`Logged in to ${result.server} as ${output.out.bold(result.user.name)} (${result.user.role}).`);
          output.print(
            output.out.dim(`Token "${result.token.name}" saved in ${result.credentials}${result.token.expiresAt ? `, expires ${relativeTime(result.token.expiresAt)}` : ""}.`),
          );
        } finally {
          interrupt.dispose();
        }
      }),
    );

  program
    .command("logout")
    .description("revoke the token of this machine and forget it")
    .action(
      run(async ({ output, ctx }) => {
        const result = await logout(ctx(), io.env);
        if (output.json) {
          output.data(result);
        } else {
          output.print(`Logged out of ${result.server}${result.revoked ? " (token revoked)" : ""}.`);
        }
      }),
    );

  program
    .command("whoami")
    .description("show the server, the user and the token in use")
    .action(
      run(async ({ output, ctx }) => {
        const result = await whoami(ctx());
        if (output.json) {
          output.data(result);
          return;
        }
        const who = result.user ? `${output.out.bold(result.user.name)} (${result.user.role})` : output.out.bold("the installation's bootstrap token");
        output.print(`${who} on ${result.server} ${output.out.dim(`(Spawner ${result.serverVersion}, CLI ${VERSION})`)}`);
        if (result.token) {
          output.print(
            `Token: ${result.token.name} (${result.token.hint})${result.token.project ? `, project ${result.token.project}` : ""}${result.token.expiresAt ? `, expires ${relativeTime(result.token.expiresAt)}` : ""}${result.source === "env" ? ", from SPAWNER_TOKEN" : ""}`,
          );
        }
        output.print(`Scopes: ${result.scopes.join(", ")}`);
      }),
    );

  program
    .command("init")
    .description("create .spawner/spawner.yaml and compose.yaml for this project")
    .option("-p, --project <slug>", "project slug (default: from the directory name)")
    .option("--port <port>", "port of the app (default: EXPOSE of the Dockerfile, or 3000)", positiveInteger)
    .addOption(new Option("--db <kind>", "database service to add (default: guessed from the dependencies)").choices(["postgres", "mysql", "none"]))
    .option("--agents [file]", "add the instructions for coding agents to this file (default: CLAUDE.md or AGENTS.md)")
    .option("--no-agents", "do not add the instructions for coding agents")
    .option("--force", "replace existing files in .spawner/")
    .action(
      run(async ({ output, cwd }, options: { project?: string; port?: number; db?: Database; agents?: string | boolean; force?: boolean }) => {
        let agentsFile: string | null = null;
        const suggested = defaultAgentsFile(cwd);
        if (typeof options.agents === "string") {
          agentsFile = options.agents;
        } else if (options.agents === true) {
          agentsFile = suggested.file;
        } else if (options.agents === undefined && !output.json && io.stdin.isTTY && io.stderr.isTTY) {
          const verb = suggested.exists ? "Add" : "Create";
          agentsFile = (await ask(io, `${verb} ${suggested.file} with the instructions for coding agents? [Y/n] `)) ? suggested.file : null;
        }
        const result = await init({ dir: cwd, project: options.project, port: options.port, db: options.db, agentsFile, force: options.force });
        if (output.json) {
          output.data(result);
          return;
        }
        result.files.forEach((file) => output.print(`Created ${file}`));
        if (result.agentsFile) {
          output.print(`Added the instructions for coding agents to ${result.agentsFile}`);
        }
        result.warnings.forEach((warning) => output.warn(warning));
        output.print("");
        output.print(`Next: an admin registers the project ${output.out.bold(result.project)} in the dashboard (Projects), then:`);
        output.print("  spawner up --wait");
      }),
    );

  program
    .command("up")
    .description("create or update the environment of this worktree (uncommitted changes included)")
    .argument("[env]", "environment name (default: from the branch)")
    .option("--source <name=path>", "send another source of spawner.yaml from a local directory (repeatable)", keyValue)
    .option("--ref <name=ref>", "take a source from git at a branch, tag or commit (repeatable)", keyValue)
    .option("-w, --wait", "wait until the environment is ready")
    .option("--fresh", "drop the data and start from scratch")
    .option("--reseed", "replay the seed steps")
    .option("--ttl <duration>", "lifetime, such as 24h (default: spawner.yaml, or the server's)")
    .option("--timeout <duration>", "how long --wait waits (default: 30m)", seconds)
    .option("--logs", "stream the build log while waiting")
    .action(
      run(
        async (
          { output, ctx },
          env: string | undefined,
          options: { source?: Record<string, string>; ref?: Record<string, string>; wait?: boolean; fresh?: boolean; reseed?: boolean; ttl?: string; timeout?: number; logs?: boolean },
        ) => {
          const context = ctx();
          const interrupt = interruptSignal();
          const streams: Promise<void>[] = [];
          try {
            const result = await up(context, {
              env,
              sources: options.source,
              refs: options.ref,
              fresh: options.fresh,
              reseed: options.reseed,
              ttl: options.ttl,
              wait: options.wait || options.logs,
              timeoutSec: options.timeout,
              signal: interrupt.signal,
              onProgress: (message) => output.note(output.err.dim(message)),
              onJob: (job) => {
                if (options.logs && !output.json) {
                  streams.push(
                    (async () => {
                      for await (const line of followJobLog(context, job.id, interrupt.signal)) {
                        output.stderr(output.err.dim(line));
                      }
                    })().catch(() => undefined),
                  );
                }
              },
            });
            await Promise.race([Promise.all(streams), new Promise((resolve) => setTimeout(resolve, 2000).unref())]);
            result.warnings.forEach((warning) => output.warn(warning));
            const code = jobExitCode(result);
            if (result.logTail?.length) {
              output.stderr(`--- end of the job log (spawner logs ${result.environment.slug} --job) ---\n${result.logTail.join("\n")}`);
            }
            if (output.json) {
              output.data(result);
              return code;
            }
            const environment = result.environment;
            if (!result.waited) {
              output.print(`${result.action === "created" ? "Creating" : "Updating"} ${output.out.bold(environment.slug)} (${environment.project}): job ${result.job.id} queued.`);
              output.print(output.out.dim(`Follow it: spawner logs ${environment.slug} --job --follow; spawner status ${environment.slug}`));
              return code;
            }
            if (code === EXIT.timeout) {
              output.print(`${environment.slug} is still ${environment.status}: the job goes on on the server (spawner status ${environment.slug}).`);
              return code;
            }
            if (code !== EXIT.ok) {
              output.stderr(output.err.red(`${environment.slug} failed${result.job.phase ? ` during ${result.job.phase}` : ""}: ${result.job.error ?? "unknown error"}`));
              output.stderr(output.err.dim("Fix the cause, then run spawner up again."));
              return code;
            }
            output.print(`${output.out.bold(environment.slug)} (${environment.project}) is ${output.out.green("ready")}`);
            urlLines(environment, output.out).forEach((line) => output.print(`  ${line}`));
            const access = environment.exposures.some((exposure) => exposure.auth !== "none")
              ? ` The URLs need a login; for curl or tests: spawner url ${environment.slug} --with-token`
              : "";
            output.print(output.out.dim(`Expires ${relativeTime(environment.expiresAt)}.${access}`));
            return code;
          } finally {
            interrupt.dispose();
          }
        },
      ),
    );

  program
    .command("status")
    .description("an environment: status, URLs, sources, expiry, and its services (restarts, out-of-memory kills)")
    .argument("[env]", "environment (default: from the branch)")
    .addOption(projectOption())
    .action(
      run(async ({ output, ctx }, env: string | undefined, options: { project?: string }) => {
        const result = await status(ctx(), { env, project: options.project });
        if (output.json) {
          output.data(result);
        } else {
          output.print(renderStatus(result.environment, result.services, output.out, result));
        }
      }),
    );

  program
    .command("ls")
    .alias("list")
    .description("list environments: of this project, or all of them outside a project")
    .addOption(projectOption())
    .option("-a, --all", "every project")
    .option("--mine", "only yours")
    .action(
      run(async ({ output, ctx, cwd }, options: { project?: string; all?: boolean; mine?: boolean }) => {
        let project = options.project;
        if (!project && !options.all) {
          const workspace = await loadWorkspace(cwd);
          project = workspace ? (manifestProject(workspace) ?? undefined) : undefined;
        }
        const result = await list(ctx(), { project, mine: options.mine });
        if (output.json) {
          output.data(result);
        } else if (result.environments.length === 0) {
          output.print(output.out.dim(`No environment${project ? ` in ${project}` : ""}.`));
        } else {
          output.print(renderList(result.environments, output.out));
        }
      }),
    );

  program
    .command("logs")
    .description("output of the services (or of the last job with --job)")
    .argument("[env]", "environment (default: from the branch)")
    .argument("[service]", "service, or several separated by commas (default: all)")
    .addOption(projectOption())
    .option("-f, --follow", "keep printing new lines")
    .option("-n, --tail <lines>", "number of lines (default: 200)", positiveInteger)
    .option("--since <time>", "from a duration ago (10m, 2h) or a date")
    .option("--grep <text>", "only the lines containing this text (case-insensitive)")
    .option("--errors", "only the lines reporting errors, with their stack traces")
    .option("--job [id]", "the log of a job: the last one by default")
    .option("-t, --timestamps", "show the time of each line")
    .action(
      run(
        async (
          { output, ctx },
          env: string | undefined,
          service: string | undefined,
          options: { project?: string; follow?: boolean; tail?: number; since?: string; grep?: string; errors?: boolean; job?: string | boolean; timestamps?: boolean },
        ) => {
          const context = ctx();
          const interrupt = interruptSignal();
          try {
            if (options.job) {
              const { environment, job, lines } = await readJobLog(context, { env, project: options.project, job: typeof options.job === "string" ? options.job : undefined });
              const finished = ["succeeded", "failed", "cancelled"].includes(job.status);
              if (!options.follow || finished) {
                if (output.json) {
                  output.data({ job, lines });
                } else {
                  lines.forEach((line) => output.print(line));
                }
                return;
              }
              for await (const line of followJobLog(context, job.id, interrupt.signal)) {
                if (output.json) {
                  output.record({ job: job.id, text: line });
                } else {
                  output.print(line);
                }
              }
              output.note(output.err.dim(`Job ${job.type} of ${environment.slug}: ${(await context.api().get<{ status: string }>(`/jobs/${job.id}`)).status}`));
              return;
            }

            const query = {
              env,
              project: options.project,
              services: service ? service.split(",").map((name) => name.trim()).filter(Boolean) : undefined,
              tail: options.tail,
              since: options.since,
              grep: options.grep,
              errors: options.errors,
            };
            const single = query.services?.length === 1;
            const palette = [output.out.cyan, output.out.magenta, output.out.blue, output.out.yellow, output.out.green];
            const colors = new Map<string, (text: string) => string>();
            const show = (line: LogLine) => {
              if (output.json) {
                output.record(line);
                return;
              }
              const color = colors.get(line.service) ?? palette[colors.size % palette.length];
              colors.set(line.service, color);
              const time = options.timestamps ? `${output.out.dim(line.time.slice(11, 23))} ` : "";
              output.print(`${time}${single ? "" : `${color(line.service)} | `}${line.text}`);
            };

            if (options.follow) {
              const environment = await ensureAwake(context, await findEnvironment(context, await resolveTarget(context, query)), (message) =>
                output.note(output.err.dim(message)),
              );
              for await (const line of followLogs(context, environment, query, interrupt.signal)) {
                show(line);
              }
              return;
            }
            const { lines } = await readLogs(context, query);
            if (output.json) {
              output.data({ lines });
            } else if (lines.length === 0) {
              output.note(output.err.dim(options.errors || options.grep ? "No matching line." : "No output yet."));
            } else {
              lines.forEach(show);
            }
          } finally {
            interrupt.dispose();
          }
        },
      ),
    );

  program
    .command("exec")
    .description("run a command in a service and exit with its exit code")
    .argument("<env>", "environment")
    .argument("<service>", "service, such as db")
    .argument("[command...]", "the command, after --: spawner exec feat-login db -- psql -c 'select 1'")
    .addOption(projectOption())
    .option("-i, --stdin", "send this command's standard input (up to 1 MiB)")
    .option("--timeout <duration>", "give up after this long (default: 120s, at most 600s)", seconds)
    .action(
      run(async ({ output, ctx }, env: string, service: string, argv: string[], options: { project?: string; stdin?: boolean; timeout?: number }) => {
        const stdin = options.stdin ? await readAll(io.stdin) : undefined;
        const result = await exec(ctx(), {
          env,
          project: options.project,
          service,
          argv,
          timeoutSec: options.timeout,
          stdin,
          onProgress: (message) => output.note(output.err.dim(message)),
        });
        if (output.json) {
          output.data(result);
        } else {
          io.stdout.write(result.stdout);
          io.stderr.write(result.stderr);
          if (result.truncated) {
            output.warn("the output was cut at 1 MiB");
          }
        }
        if (result.timedOut) {
          if (!output.json) {
            output.stderr(output.err.red(`the command did not finish within ${options.timeout ?? 120}s`));
          }
          return EXIT.timeout;
        }
        return result.exitCode;
      }),
    );

  program
    .command("shell")
    .description("open an interactive terminal in a service")
    .argument("<env>", "environment")
    .argument("<service>", "service")
    .addOption(projectOption())
    .action(
      run(async ({ output, ctx }, env: string, service: string, options: { project?: string }) => {
        return shell(
          ctx(),
          { env, project: options.project, service, onProgress: (message) => output.note(output.err.dim(message)) },
          { stdin: io.stdin, stdout: io.stdout },
        );
      }),
    );

  program
    .command("stats")
    .description("CPU, memory, disk, restarts and out-of-memory kills of each service")
    .argument("[env]", "environment (default: from the branch)")
    .addOption(projectOption())
    .action(
      run(async ({ output, ctx }, env: string | undefined, options: { project?: string }) => {
        const result = await stats(ctx(), { env, project: options.project });
        if (output.json) {
          output.data(result);
        } else {
          output.print(`${output.out.bold(result.environment.slug)} (${result.environment.project})  ${result.environment.status}`);
          output.print(renderUsage(result.services, output.out));
        }
      }),
    );

  program
    .command("capacity")
    .description("how many more environments of each project fit on the server")
    .addOption(new Option("-p, --project <slug>", "only this project"))
    .action(
      run(async ({ output, ctx }, options: { project?: string }) => {
        const result = await capacity(ctx(), { project: options.project });
        if (output.json) {
          output.data(result);
        } else {
          output.print(renderCapacity(result, output.out, formatBytes));
        }
      }),
    );

  program
    .command("url")
    .description("print the URL of an environment; --with-token adds the header that opens it")
    .argument("[env]", "environment (default: from the branch)")
    .argument("[exposure]", "exposure of spawner.yaml (default: the entrypoint)")
    .addOption(projectOption())
    .option("--with-token", "also print the X-Spawner-Preview header, valid one hour")
    .action(
      run(async ({ output, ctx }, env: string | undefined, exposure: string | undefined, options: { project?: string; withToken?: boolean }) => {
        const result = await url(ctx(), {
          env,
          project: options.project,
          exposure,
          withToken: options.withToken,
          onProgress: (message) => output.note(output.err.dim(message)),
        });
        if (output.json) {
          output.data(result);
          return;
        }
        output.print(result.url);
        if (result.header) {
          output.print(`${result.header.name}: ${result.header.value}`);
          output.note(output.err.dim(`Valid until ${new Date(result.expiresAt!).toLocaleTimeString()}: curl -H "${result.header.name}: ${result.header.value}" ${result.url}`));
        }
      }),
    );

  program
    .command("share")
    .description("create a link that opens the environment without an account")
    .argument("[env]", "environment (default: from the branch)")
    .addOption(projectOption())
    .option("--ttl <duration>", "how long the link works, in whole hours (default: 24h)")
    .action(
      run(async ({ output, ctx }, env: string | undefined, options: { project?: string; ttl?: string }) => {
        const result = await share(ctx(), { env, project: options.project, ttl: options.ttl });
        if (output.json) {
          output.data(result);
        } else {
          output.print(result.url);
          output.note(output.err.dim(`Works until ${new Date(result.expiresAt).toLocaleString()}, for anyone with the link.`));
        }
      }),
    );

  for (const [name, description] of [
    ["stop", "stop the containers of an environment (its data stays)"],
    ["start", "start a stopped environment"],
    ["sleep", "put an environment to sleep now: its data stays, the next visit wakes it up"],
    ["wake", "wake a sleeping environment up"],
    ["down", "delete an environment and everything it holds"],
  ] as const) {
    program
      .command(name)
      .description(description)
      .argument("[env]", "environment (default: from the branch)")
      .addOption(projectOption())
      .option("--no-wait", "return once the job is queued")
      .option("--timeout <duration>", "how long to wait (default: 10m)", seconds)
      .action(
        run(async ({ output, ctx }, env: string | undefined, options: { project?: string; wait: boolean; timeout?: number }) => {
          const result = await lifecycle(ctx(), name, {
            env,
            project: options.project,
            wait: options.wait,
            timeoutSec: options.timeout,
            onProgress: (message) => output.note(output.err.dim(message)),
          });
          const code = jobExitCode(result);
          if (result.logTail?.length) {
            output.stderr(`--- end of the job log ---\n${result.logTail.join("\n")}`);
          }
          if (output.json) {
            output.data(result);
          } else if (!result.job) {
            output.print(`${output.out.bold(result.environment.slug)} (${result.environment.project}) is already ${name === "wake" ? "awake" : "asleep"}.`);
          } else if (!result.waited) {
            output.print(`Job ${result.job.id} queued (${name} ${result.environment.slug}).`);
          } else if (code === EXIT.ok) {
            const done = { stop: "stopped", start: "started", sleep: "asleep: the next visit wakes it up", wake: "awake", down: "deleted" }[name];
            output.print(`${output.out.bold(result.environment.slug)} (${result.environment.project}) ${done}.`);
            if (name === "start" || name === "wake") {
              urlLines(result.environment, output.out).forEach((line) => output.print(`  ${line}`));
            }
          } else {
            output.stderr(output.err.red(`${name} ${result.environment.slug}: ${code === EXIT.timeout ? "still running on the server" : (result.job.error ?? "failed")}`));
          }
          return code;
        }),
      );
  }

  program
    .command("extend")
    .description("postpone the expiry of an environment")
    .argument("[env]", "environment (default: from the branch)")
    .addOption(projectOption())
    .requiredOption("--ttl <duration>", "new lifetime from now, such as 24h or 3d")
    .action(
      run(async ({ output, ctx }, env: string | undefined, options: { project?: string; ttl: string }) => {
        const result = await extend(ctx(), { env, project: options.project, ttl: options.ttl });
        if (output.json) {
          output.data(result);
        } else {
          output.print(`${output.out.bold(result.environment.slug)} now expires ${relativeTime(result.environment.expiresAt)}.`);
        }
      }),
    );

  const token = program.command("token").description("personal API tokens, for agents and scripts");
  token
    .command("create")
    .description("create a token (shown once)")
    .requiredOption("--name <name>", "name, shown on the environments it creates (such as claude)")
    .option("--scopes <scopes>", "comma-separated: envs:read, envs:write, envs:exec, preview, admin (default: all but admin)")
    .option("--expires <duration>", "lifetime, such as 30d (default: 90d, at most 365d)")
    .addOption(new Option("-p, --project <slug>", "restrict the token to one project"))
    .action(
      run(async ({ output, ctx }, options: { name: string; scopes?: string; expires?: string; project?: string }) => {
        let expiresInDays: number | undefined;
        if (options.expires) {
          const duration = parseDuration(options.expires);
          if (duration === null || duration < 86400 || duration % 86400 !== 0) {
            throw usageError(`--expires ${options.expires}: give whole days, such as 30d`);
          }
          expiresInDays = duration / 86400;
        }
        const scopes = options.scopes?.split(",").map((scope) => scope.trim()).filter(Boolean);
        const result = await createToken(ctx(), { name: options.name, scopes, expiresInDays, project: options.project });
        if (output.json) {
          output.data(result);
          return;
        }
        output.print(result.token);
        output.note(
          output.err.dim(
            `Token "${result.info.name}" (${result.info.scopes.join(", ")}${result.info.project ? `, project ${result.info.project}` : ""}), expires ${relativeTime(result.info.expiresAt)}. It is shown once: give it to the agent as SPAWNER_TOKEN, with SPAWNER_URL.`,
          ),
        );
      }),
    );
  token
    .command("ls")
    .alias("list")
    .description("list your tokens")
    .option("-a, --all", "everyone's (admins)")
    .action(
      run(async ({ output, ctx }, options: { all?: boolean }) => {
        const result = await listTokens(ctx(), options);
        if (output.json) {
          output.data(result);
        } else if (result.tokens.length === 0) {
          output.print(output.out.dim("No token."));
        } else {
          output.print(
            table(
              result.tokens.map((item) => [
                item.name,
                item.hint,
                item.scopes.join(","),
                item.project ?? "-",
                item.lastUsedAt ? relativeTime(item.lastUsedAt) : "never",
                relativeTime(item.expiresAt),
                ...(options.all ? [item.user?.name ?? "-"] : []),
              ]),
              ["NAME", "TOKEN", "SCOPES", "PROJECT", "USED", "EXPIRES", ...(options.all ? ["USER"] : [])].map((title) => output.out.dim(title)),
            ),
          );
        }
      }),
    );
  token
    .command("revoke")
    .description("revoke a token, by id or by its start (spn_ab12cd34)")
    .argument("<token>", "id or start of the token")
    .action(
      run(async ({ output, ctx }, reference: string) => {
        const result = await revokeToken(ctx(), reference);
        if (output.json) {
          output.data(result);
        } else {
          output.print(`Revoked "${result.revoked.name}" (${result.revoked.hint}).`);
        }
      }),
    );

  program
    .command("mcp")
    .description("run the MCP server (stdio), for agents: { \"command\": \"spawner\", \"args\": [\"mcp\"] }")
    .action(
      run(async ({ cwd }) => {
        await serveMcp({ cwd, env: io.env });
      }),
    );

  program.addHelpText(
    "after",
    `
Exit codes: 0 ok, 1 error, 2 usage, 3 authentication, 4 environment failed,
5 timeout, 6 capacity, 7 spawner.yaml or compose file refused.
Environment: SPAWNER_URL and SPAWNER_TOKEN replace spawner login; SPAWNER_PROJECT names the project.`,
  );
  return program;
}

function readAll(stream: NodeJS.ReadStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/**
 * Runs the CLI with arguments (without "node spawner").
 *
 * @returns The exit code
 */
export async function runCli(argv: string[], io: Io): Promise<number> {
  let exitCode: number = EXIT.ok;
  const program = buildProgram(io, (code) => (exitCode = code));
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed" || error.code === "commander.version" || error.code === "commander.help") {
        return EXIT.ok;
      }
      if (argv.includes("--json")) {
        io.stdout.write(`${JSON.stringify({ error: { code: "usage", message: error.message.replace(/^error: /, "") } }, null, 2)}\n`);
      }
      if (error.code === "commander.unknownOption" && argv[0] === "exec") {
        io.stderr.write("Put the command after --: spawner exec <env> <service> -- <command> [args...]\n");
      }
      return EXIT.usage;
    }
    const failure = error instanceof CliError ? error : asCliError(error);
    io.stderr.write(`error: ${failure.message}\n`);
    return failure.exit;
  }
  return exitCode;
}
