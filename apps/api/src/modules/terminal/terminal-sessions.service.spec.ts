import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { TerminalRecorder } from "./terminal-sessions.service";

describe("TerminalRecorder", () => {
  it("records what the terminal shows, up to its limit, and reports how it ended", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "recording-")), "session.log");
    const summaries: unknown[] = [];
    const recorder = new TerminalRecorder("s1", file, async (summary) => void summaries.push(summary), 16);
    recorder.write("$ ls\r\n");
    recorder.write("a-rather-long-line\r\n");
    recorder.write("dropped");
    await recorder.close("exit", 5);
    await recorder.close("closed");
    expect(fs.readFileSync(file, "utf8")).toBe("$ ls\r\na-rather-l\n[recording stopped at 16 bytes]\n");
    expect(summaries).toEqual([{ reason: "exit", exitCode: 5, bytes: 16, truncated: true }]);
  });
});
