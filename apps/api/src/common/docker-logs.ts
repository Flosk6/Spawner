/**
 * A line of a container's output, as Docker returns it with timestamps.
 * time is RFC 3339 with nine fractional digits, so that comparing two times
 * as strings orders them.
 */
export interface RawLogLine {
  stream: "stdout" | "stderr";
  time: string;
  text: string;
}

const STREAM_TYPES: Record<number, RawLogLine["stream"]> = { 1: "stdout", 2: "stderr" };
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2}) /;

/**
 * Splits "2026-10-07T10:00:00.123456789Z text" into its time and text. Times
 * get nine fractional digits; lines without a timestamp keep the time of the
 * line before them (fallback).
 */
export function parseTimestamped(line: string, stream: RawLogLine["stream"], fallback: string): RawLogLine {
  const match = TIMESTAMP.exec(line);
  const text = (match ? line.slice(match[0].length) : line).replace(/\r$/, "");
  if (!match) {
    return { stream, time: fallback, text };
  }
  const [, seconds, fraction = "", zone] = match;
  const utc = zone === "Z" ? `${seconds}.${fraction.padEnd(9, "0")}Z` : normalizeZone(seconds, fraction, zone);
  return { stream, time: utc, text };
}

function normalizeZone(seconds: string, fraction: string, zone: string): string {
  const date = new Date(`${seconds}${zone}`);
  return `${date.toISOString().slice(0, 19)}.${fraction.padEnd(9, "0")}Z`;
}

/**
 * Decodes the output of the Docker logs API, as it arrives. Without a TTY,
 * the stream is multiplexed: frames of an 8-byte header (stream type, three
 * zero bytes, big-endian length) followed by the payload, which may be split
 * across chunks. With a TTY, it is plain text. Either way each line starts
 * with its timestamp.
 */
export class LogDecoder {
  private buffer: Buffer = Buffer.alloc(0);
  private readonly partial: Record<RawLogLine["stream"], string> = { stdout: "", stderr: "" };
  private lastTime = "";

  constructor(private readonly tty: boolean) {}

  /**
   * Feeds a chunk of the stream.
   *
   * @returns The complete lines it ended
   */
  push(chunk: Buffer): RawLogLine[] {
    if (this.tty) {
      return this.text("stdout", chunk.toString("utf8"));
    }
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const lines: RawLogLine[] = [];
    let offset = 0;
    while (offset + 8 <= this.buffer.length) {
      const length = this.buffer.readUInt32BE(offset + 4);
      if (offset + 8 + length > this.buffer.length) {
        break;
      }
      const stream = STREAM_TYPES[this.buffer[offset]] ?? "stdout";
      lines.push(...this.text(stream, this.buffer.toString("utf8", offset + 8, offset + 8 + length)));
      offset += 8 + length;
    }
    this.buffer = this.buffer.subarray(offset);
    return lines;
  }

  /**
   * Ends the stream.
   *
   * @returns The last lines, which had no line break
   */
  end(): RawLogLine[] {
    const lines: RawLogLine[] = [];
    for (const stream of ["stdout", "stderr"] as const) {
      if (this.partial[stream]) {
        lines.push(this.line(this.partial[stream], stream));
        this.partial[stream] = "";
      }
    }
    return lines;
  }

  private text(stream: RawLogLine["stream"], text: string): RawLogLine[] {
    const parts = (this.partial[stream] + text).split("\n");
    this.partial[stream] = parts.pop() ?? "";
    return parts.map((part) => this.line(part, stream));
  }

  private line(text: string, stream: RawLogLine["stream"]): RawLogLine {
    const line = parseTimestamped(text, stream, this.lastTime);
    this.lastTime = line.time;
    return line;
  }
}

/**
 * Decodes a whole log answer at once.
 */
export function decodeLogs(buffer: Buffer, tty: boolean): RawLogLine[] {
  const decoder = new LogDecoder(tty);
  return [...decoder.push(buffer), ...decoder.end()];
}
