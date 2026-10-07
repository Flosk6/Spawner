import { describe, expect, it } from "vitest";
import { maskSecrets } from "./pipeline.service";

describe("maskSecrets", () => {
  it("hides secret values in job logs, longest first, but not very short ones", () => {
    const lines: string[] = [];
    const log = maskSecrets((line) => lines.push(line), ["sk_live_abc", "sk_live_abcdef", "ab"]);
    log("key sk_live_abcdef and sk_live_abc, ab stays");
    expect(lines).toEqual(["key ******** and ********, ab stays"]);
  });
});
