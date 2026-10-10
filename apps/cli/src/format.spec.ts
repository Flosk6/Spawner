import { describe, expect, it } from "vitest";
import { formatDuration } from "./format";

describe("formatDuration", () => {
  it("gives days and hours from three days on", () => {
    expect(formatDuration(4 * 86400 + 5 * 3600)).toBe("4d 5h");
    expect(formatDuration(5 * 86400)).toBe("5d");
  });

  it("carries rounded hours into a day", () => {
    expect(formatDuration(90 * 86400 - 60)).toBe("90d");
    expect(formatDuration(89 * 86400 + 23 * 3600 + 40 * 60)).toBe("90d");
  });

  it("keeps hours and minutes below three days", () => {
    expect(formatDuration(3600 + 120)).toBe("1h 2m");
    expect(formatDuration(71 * 3600)).toBe("71h");
  });
});
