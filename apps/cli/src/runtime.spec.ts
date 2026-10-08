import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findProgram, skipWorkingDirectoryLookup, unsupportedRuntime } from "./runtime";

describe("skipWorkingDirectoryLookup", () => {
  it("sets NoDefaultCurrentDirectoryInExePath on Windows only", () => {
    const windows: NodeJS.ProcessEnv = { PATH: "C:\\Program Files\\Git\\cmd" };
    skipWorkingDirectoryLookup("win32", windows);
    expect(windows).toEqual({ PATH: "C:\\Program Files\\Git\\cmd", NoDefaultCurrentDirectoryInExePath: "1" });

    for (const platform of ["linux", "darwin"] as const) {
      const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
      skipWorkingDirectoryLookup(platform, env);
      expect(env).toEqual({ PATH: "/usr/bin" });
    }
  });
});

describe("unsupportedRuntime", () => {
  it("needs Node.js 20", () => {
    expect(unsupportedRuntime({ node: "18.20.4" })).toBe("spawner needs Node.js 20 or later (this is v18.20.4)");
    expect(unsupportedRuntime({ node: "20.0.0" })).toBeNull();
    expect(unsupportedRuntime({ node: "24.4.0" })).toBeNull();
  });
});

describe("findProgram", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "spawner-program-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function program(directory: string, name: string, mode = 0o755): string {
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, name);
    fs.writeFileSync(file, "#!/bin/sh\n", { mode });
    return file;
  }

  it("takes the first absolute PATH entry holding a runnable file, and skips relative entries", () => {
    const worktree = path.join(dir, "worktree");
    program(path.join(worktree, "node_modules", ".bin"), "git");
    program(worktree, "git");
    program(path.join(dir, "first"), "git", 0o644);
    const real = program(path.join(dir, "second"), "git");
    fs.mkdirSync(path.join(dir, "third", "git"), { recursive: true });
    const env = { PATH: [".", "node_modules/.bin", "", path.join(dir, "first"), path.join(dir, "third"), path.join(dir, "second")].join(":") };

    const cwd = process.cwd();
    process.chdir(worktree);
    try {
      expect(findProgram("git", { env, platform: "linux" })).toBe(real);
    } finally {
      process.chdir(cwd);
    }
  });

  it("answers null when no absolute PATH entry holds the program", () => {
    expect(findProgram("git", { env: { PATH: `.:${path.join(dir, "empty")}` }, platform: "linux" })).toBeNull();
    expect(findProgram("git", { env: {}, platform: "linux" })).toBeNull();
  });

  it("on Windows, reads Path in any case, skips relative and drive-relative entries, and tries .com then .exe", () => {
    const found: string[] = [];
    const isProgram = (candidate: string) => {
      found.push(candidate);
      return candidate === "C:\\Program Files\\Git\\cmd\\git.exe";
    };
    const env = { Path: ".;tools;C:bin;C:\\Program Files\\Git\\cmd;C:\\Windows\\System32" };
    expect(findProgram("git", { env, platform: "win32", isProgram })).toBe("C:\\Program Files\\Git\\cmd\\git.exe");
    expect(found).toEqual(["C:\\Program Files\\Git\\cmd\\git.com", "C:\\Program Files\\Git\\cmd\\git.exe"]);

    expect(findProgram("rundll32.exe", { env, platform: "win32", isProgram: (candidate) => candidate === "C:\\Windows\\System32\\rundll32.exe" })).toBe(
      "C:\\Windows\\System32\\rundll32.exe",
    );
  });
});
