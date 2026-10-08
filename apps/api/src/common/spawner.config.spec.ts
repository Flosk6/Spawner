import { afterEach, describe, expect, it, vi } from "vitest";
import { SpawnerConfig } from "./spawner.config";

describe("SpawnerConfig", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reaches Spawner by its name qualified by the network of the stack, unless told otherwise", () => {
    vi.stubEnv("SPAWNER_DASHBOARD_UPSTREAM", undefined);
    expect(new SpawnerConfig().dashboardUpstream).toBe("http://spawner.spawner-core:3000");

    vi.stubEnv("SPAWNER_DASHBOARD_UPSTREAM", "http://spawner.other-stack:3000");
    expect(new SpawnerConfig().dashboardUpstream).toBe("http://spawner.other-stack:3000");
  });
});
