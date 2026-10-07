import { CliError } from "./errors";

export interface Styles {
  bold: (text: string) => string;
  dim: (text: string) => string;
  red: (text: string) => string;
  green: (text: string) => string;
  yellow: (text: string) => string;
  cyan: (text: string) => string;
  magenta: (text: string) => string;
  blue: (text: string) => string;
}

const CODES: Record<keyof Styles, [number, number]> = {
  bold: [1, 22],
  dim: [2, 22],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  cyan: [36, 39],
  magenta: [35, 39],
  blue: [34, 39],
};

export function styles(enabled: boolean): Styles {
  const entries = Object.entries(CODES).map(([name, [open, close]]) => [name, enabled ? (text: string) => `\x1b[${open}m${text}\x1b[${close}m` : (text: string) => text]);
  return Object.fromEntries(entries) as unknown as Styles;
}

/**
 * Colors only on a terminal, unless NO_COLOR is set (or FORCE_COLOR asks for them).
 */
export function colorEnabled(stream: { isTTY?: boolean }, env: NodeJS.ProcessEnv): boolean {
  if (env.FORCE_COLOR && env.FORCE_COLOR !== "0") {
    return true;
  }
  return Boolean(stream.isTTY) && !env.NO_COLOR && env.TERM !== "dumb";
}

export interface Streams {
  stdout: { write: (text: string) => unknown; isTTY?: boolean };
  stderr: { write: (text: string) => unknown; isTTY?: boolean };
}

/**
 * Where a command writes. With --json, stdout carries only JSON (one
 * document, or one object per line for streams); human messages go to
 * stderr either way.
 */
export class Output {
  readonly out: Styles;
  readonly err: Styles;

  constructor(
    readonly json: boolean,
    private readonly streams: Streams,
    env: NodeJS.ProcessEnv,
    readonly quiet = false,
  ) {
    this.out = styles(!json && colorEnabled(streams.stdout, env));
    this.err = styles(colorEnabled(streams.stderr, env));
  }

  get interactive(): boolean {
    return Boolean(this.streams.stderr.isTTY);
  }

  /** A line of the human result, on stdout. */
  print(text = ""): void {
    this.streams.stdout.write(`${text}\n`);
  }

  /** The JSON result. */
  data(value: unknown): void {
    this.streams.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  }

  /** One JSON object per line, for streamed results. */
  record(value: unknown): void {
    this.streams.stdout.write(`${JSON.stringify(value)}\n`);
  }

  /** Progress for humans, on stderr; silent with --json or --quiet. */
  note(text: string): void {
    if (!this.json && !this.quiet) {
      this.streams.stderr.write(`${text}\n`);
    }
  }

  /** Text that goes to stderr whatever the mode (the end of a failed job log). */
  stderr(text: string): void {
    this.streams.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
  }

  warn(text: string): void {
    if (!this.json) {
      this.streams.stderr.write(`${this.err.yellow("warning:")} ${text}\n`);
    }
  }

  error(error: CliError): void {
    if (this.json) {
      this.streams.stdout.write(`${JSON.stringify({ error: error.toJSON() }, null, 2)}\n`);
      return;
    }
    this.streams.stderr.write(`${this.err.red("error:")} ${error.message}\n`);
    if (error.hint) {
      this.streams.stderr.write(`${this.err.dim(error.hint)}\n`);
    }
  }
}
