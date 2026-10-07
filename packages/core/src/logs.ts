/**
 * Words that mark a line as an error whatever its format: "TypeError: ...",
 * "ERROR: relation does not exist", "panic: ...", "Traceback (most recent
 * call last)", "UnhandledPromiseRejection", "[crit]"...
 */
const ERROR_WORDS =
  /error|exception|fatal|panic|traceback|uncaught|unhandled|critical|severe|segmentation fault|out of memory|\[(?:crit|alert|emerg)\]/i;

/**
 * Lines that continue the message before them: indented lines (stack frames,
 * code excerpts), "Caused by:", "... 12 more".
 */
const CONTINUATION = /^(?:\s+\S|Caused by:|\s*\.\.\. \d+ more)/;

const LEVEL_KEYS = ['level', 'severity', 'levelname', 'lvl'];
const ERROR_LEVELS = new Set(['error', 'err', 'fatal', 'critical', 'crit', 'alert', 'emerg', 'emergency', 'panic', 'severe']);
const OTHER_LEVELS = new Set(['trace', 'debug', 'info', 'notice', 'warn', 'warning', 'verbose', 'http', 'silly']);

/**
 * Level of a JSON log line (pino, bunyan, winston, structlog, ECS...).
 *
 * @returns true for an error level, false for another level, null when the
 *   line is not JSON or has no level
 */
function jsonErrorLevel(text: string): boolean | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }
  let record: unknown;
  try {
    record = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof record !== 'object' || record === null) {
    return null;
  }
  const fields = record as Record<string, unknown>;
  const nested = typeof fields.log === 'object' && fields.log !== null ? (fields.log as Record<string, unknown>).level : undefined;
  for (const value of [...LEVEL_KEYS.map((key) => fields[key]), fields['log.level'], nested]) {
    if (typeof value === 'number') {
      return value >= 50;
    }
    if (typeof value === 'string') {
      const level = value.toLowerCase();
      if (ERROR_LEVELS.has(level)) {
        return true;
      }
      if (OTHER_LEVELS.has(level)) {
        return false;
      }
    }
  }
  return null;
}

/**
 * Tells whether a log line reports an error. A JSON line with a level is
 * judged by its level only; any other line by the words it contains. The
 * stream alone decides nothing: Postgres, Python's logging and nginx write
 * routine messages to stderr.
 */
export function isErrorLine(text: string): boolean {
  return jsonErrorLevel(text) ?? ERROR_WORDS.test(text);
}

/**
 * Keeps the error lines of a log, each with the lines that continue it (a
 * stack trace under "TypeError: ..."), service by service. Lines must come
 * in order for each service.
 */
export class ErrorLineFilter {
  private readonly inError = new Map<string, boolean>();

  /**
   * Tells what a line is: the first line of an error, a line continuing the
   * error before it (an indented line inside an error is a continuation,
   * even when it mentions an error, such as "at parseErrorMessage"), or
   * neither.
   */
  classify(line: { service: string; text: string }): 'error' | 'continuation' | null {
    if (this.inError.get(line.service) && CONTINUATION.test(line.text)) {
      return 'continuation';
    }
    if (isErrorLine(line.text)) {
      this.inError.set(line.service, true);
      return 'error';
    }
    this.inError.set(line.service, false);
    return null;
  }

  accept(line: { service: string; text: string }): boolean {
    return this.classify(line) !== null;
  }
}

/**
 * Tells whether a line contains a text, ignoring case.
 */
export function matchesGrep(text: string, grep: string): boolean {
  return text.toLowerCase().includes(grep.toLowerCase());
}
