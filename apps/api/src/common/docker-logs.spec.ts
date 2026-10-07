import { describe, expect, it } from "vitest";
import { decodeLogs, LogDecoder, parseTimestamped } from "./docker-logs";

function frame(stream: 1 | 2, text: string): Buffer {
  const payload = Buffer.from(text);
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

describe("parseTimestamped", () => {
  it("pads the fraction so that times compare as strings", () => {
    expect(parseTimestamped("2026-10-07T10:00:00.12Z hello", "stdout", "")).toEqual({
      stream: "stdout",
      time: "2026-10-07T10:00:00.120000000Z",
      text: "hello",
    });
    expect(parseTimestamped("2026-10-07T10:00:00.12Z a", "stdout", "").time > parseTimestamped("2026-10-07T10:00:00.1200001Z b", "stdout", "").time).toBe(false);
  });

  it("converts offsets to UTC and keeps lines without a timestamp", () => {
    expect(parseTimestamped("2026-10-07T12:00:00.5+02:00 x", "stderr", "").time).toBe("2026-10-07T10:00:00.500000000Z");
    expect(parseTimestamped("no timestamp\r", "stdout", "T")).toEqual({ stream: "stdout", time: "T", text: "no timestamp" });
  });
});

describe("LogDecoder", () => {
  it("decodes multiplexed frames split across chunks", () => {
    const data = Buffer.concat([
      frame(1, "2026-10-07T10:00:00.000000001Z listening\n"),
      frame(2, "2026-10-07T10:00:01.000000000Z Error: boom\n"),
    ]);
    const decoder = new LogDecoder(false);
    const lines = [...decoder.push(data.subarray(0, 5)), ...decoder.push(data.subarray(5, 50)), ...decoder.push(data.subarray(50)), ...decoder.end()];
    expect(lines).toEqual([
      { stream: "stdout", time: "2026-10-07T10:00:00.000000001Z", text: "listening" },
      { stream: "stderr", time: "2026-10-07T10:00:01.000000000Z", text: "Error: boom" },
    ]);
  });

  it("reads the plain output of a TTY, and a last line without a line break", () => {
    const lines = decodeLogs(Buffer.from("2026-10-07T10:00:00Z one\r\n2026-10-07T10:00:01Z two"), true);
    expect(lines.map((line) => [line.stream, line.text])).toEqual([
      ["stdout", "one"],
      ["stdout", "two"],
    ]);
  });
});
