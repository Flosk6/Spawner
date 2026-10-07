import { describe, expect, it } from "vitest";
import { KeyedMutex } from "./keyed-mutex";
import { CommandError, baseEnv, run } from "./process";

describe("run", () => {
  it("passes arguments verbatim, without a shell", async () => {
    const { stdout } = await run(process.execPath, ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", "a b", "$(whoami)", "'; rm -rf /"], {
      env: baseEnv("/tmp"),
    });
    expect(JSON.parse(stdout)).toEqual(["a b", "$(whoami)", "'; rm -rf /"]);
  });

  it("only gives the child the environment it is handed", async () => {
    process.env.SPAWNER_TEST_SECRET = "leaked";
    try {
      const { stdout } = await run(process.execPath, ["-e", "console.log(process.env.SPAWNER_TEST_SECRET ?? 'absent')"], { env: baseEnv("/tmp") });
      expect(stdout.trim()).toBe("absent");
    } finally {
      delete process.env.SPAWNER_TEST_SECRET;
    }
  });

  it("streams output lines", async () => {
    const lines: string[] = [];
    await run(process.execPath, ["-e", "console.log('one'); console.error('two'); console.log('three')"], { env: baseEnv("/tmp"), onLine: (line) => lines.push(line) });
    expect(lines.sort()).toEqual(["one", "three", "two"]);
  });

  it("reports the exit code and the end of stderr", async () => {
    const error = await run(process.execPath, ["-e", "console.error('it broke'); process.exit(3)"], { env: baseEnv("/tmp") }).catch((e) => e);
    expect(error).toBeInstanceOf(CommandError);
    expect(error.exitCode).toBe(3);
    expect(error.message).toContain("it broke");
  });

  it("stops programs that run too long", async () => {
    await expect(run(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { env: baseEnv("/tmp"), timeoutMs: 200 })).rejects.toThrow(/timed out/);
  });
});

describe("KeyedMutex", () => {
  it("serializes work on the same key and parallelizes different keys", async () => {
    const mutex = new KeyedMutex();
    const events: string[] = [];
    const task = (key: string, label: string, ms: number) =>
      mutex.run(key, async () => {
        events.push(`start ${label}`);
        await new Promise((resolve) => setTimeout(resolve, ms));
        events.push(`end ${label}`);
      });

    await Promise.all([task("repo", "a", 30), task("repo", "b", 1), task("other", "c", 1)]);

    expect(events.indexOf("end a")).toBeLessThan(events.indexOf("start b"));
    expect(events.indexOf("start c")).toBeLessThan(events.indexOf("end a"));
  });
});
