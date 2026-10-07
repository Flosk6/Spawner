/**
 * Exit codes of every command. They are part of the CLI's contract: agents
 * and scripts branch on them.
 */
export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  auth: 3,
  /** The environment failed (the end of the job log goes to stderr). */
  failed: 4,
  timeout: 5,
  capacity: 6,
  /** spawner.yaml or the compose file was refused. */
  refused: 7,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export interface CliErrorOptions {
  exit?: ExitCode;
  /** Stable machine-readable code: usage, not_logged_in, not_found... */
  code?: string;
  /** What to do about it. */
  hint?: string;
  /** HTTP status of the API answer, when the error comes from the API. */
  status?: number;
  details?: Record<string, unknown>;
}

/**
 * An error the CLI reports and exits with: a stable code for machines, a
 * message and a hint for humans.
 */
export class CliError extends Error {
  readonly exit: ExitCode;
  readonly code: string;
  readonly hint?: string;
  readonly status?: number;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: CliErrorOptions = {}) {
    super(message);
    this.name = "CliError";
    this.exit = options.exit ?? EXIT.error;
    this.code = options.code ?? "error";
    this.hint = options.hint;
    this.status = options.status;
    this.details = options.details;
  }

  toJSON() {
    return { code: this.code, message: this.message, ...(this.hint ? { hint: this.hint } : {}), ...(this.status ? { status: this.status } : {}), ...this.details };
  }
}

export function usageError(message: string, hint?: string): CliError {
  return new CliError(message, { exit: EXIT.usage, code: "usage", hint });
}

/**
 * Turns anything thrown into a CliError.
 */
export function asCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new CliError(message, { code: "internal" });
}
