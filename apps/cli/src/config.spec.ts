import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { configDir, normalizeServer, readCredentials, resolveConnection, writeCredentials, type Credentials } from "./config";
import { tempDir } from "./testing/repo";

const credentials: Credentials = {
  version: 1,
  current: "https://spawner.example.com",
  servers: {
    "https://spawner.example.com": { token: "spn_stored", tokenId: "t1", tokenName: "laptop", user: null, expiresAt: null, savedAt: "" },
  },
};

describe("config", () => {
  it("normalizes server addresses to their origin", () => {
    expect(normalizeServer("spawner.example.com")).toBe("https://spawner.example.com");
    expect(normalizeServer("http://spawner.localtest.me/")).toBe("http://spawner.localtest.me");
    expect(normalizeServer("https://spawner.example.com/projects")).toBe("https://spawner.example.com");
    expect(() => normalizeServer("ftp://x")).toThrow();
  });

  it("prefers SPAWNER_URL and SPAWNER_TOKEN to the stored login", () => {
    expect(resolveConnection({}, credentials)).toEqual({ server: "https://spawner.example.com", token: "spn_stored", source: "credentials" });
    expect(resolveConnection({ SPAWNER_TOKEN: "spn_env" }, credentials)).toEqual({ server: "https://spawner.example.com", token: "spn_env", source: "env" });
    expect(resolveConnection({ SPAWNER_URL: "other.example.com" }, credentials)).toEqual({ server: "https://other.example.com", token: null, source: "none" });
  });

  it("stores credentials for their owner only", () => {
    const file = path.join(tempDir(), "spawner", "credentials.json");
    writeCredentials(file, credentials);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    expect(readCredentials(file)).toEqual(credentials);
    expect(readCredentials(path.join(tempDir(), "missing.json"))).toEqual({ version: 1, current: null, servers: {} });
  });

  it("follows XDG_CONFIG_HOME", () => {
    expect(configDir({ XDG_CONFIG_HOME: "/x" }, "linux", "/home/a")).toBe("/x/spawner");
    expect(configDir({}, "linux", "/home/a")).toBe("/home/a/.config/spawner");
  });
});
