import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SecretsService } from "./secrets.service";
import type { SpawnerConfig } from "./spawner.config";

describe("SecretsService", () => {
  let dataDir: string;
  let secrets: SecretsService;
  const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "spawner-secrets-"));
    secrets = new SecretsService({ dataDir, secret: null } as SpawnerConfig);
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("generates the master secret once, readable by its owner only", () => {
    const key = secrets.key("anything");
    const file = path.join(dataDir, "secret.key");

    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(new SecretsService({ dataDir, secret: null } as SpawnerConfig).key("anything")).toEqual(key);
  });

  it("derives a different key for each purpose", () => {
    expect(secrets.key("session")).not.toEqual(secrets.key("settings"));
  });

  it("verifies its own tokens and nothing else", () => {
    const token = secrets.sign("preview-cookie", { exp: inAnHour(), sub: 7 });

    expect(secrets.verify("preview-cookie", token)).toMatchObject({ sub: 7 });
    expect(secrets.verify("preview-header", token)).toBeNull();
    expect(secrets.verify("preview-cookie", `${token.split(".")[0]}.${"A".repeat(43)}`)).toBeNull();
    expect(secrets.verify("preview-cookie", token.replace(/^./, (c) => (c === "e" ? "f" : "e")))).toBeNull();
    expect(new SecretsService({ dataDir, secret: "another installation's secret" } as SpawnerConfig).verify("preview-cookie", token)).toBeNull();
  });

  it("refuses expired and malformed tokens", () => {
    expect(secrets.verify("x", secrets.sign("x", { exp: Math.floor(Date.now() / 1000) - 1 }))).toBeNull();
    expect(secrets.verify("x", undefined)).toBeNull();
    expect(secrets.verify("x", "a.b.c")).toBeNull();
    expect(secrets.verify("x", "not-a-token")).toBeNull();
  });

  it("encrypts settings so that only this installation reads them, unaltered", () => {
    const encrypted = secrets.encrypt("github client secret");

    expect(encrypted).not.toContain("github");
    expect(secrets.decrypt(encrypted)).toBe("github client secret");
    expect(secrets.encrypt("github client secret")).not.toBe(encrypted);
    const [version, iv, ciphertext, tag] = encrypted.split(".");
    const altered = Buffer.from(ciphertext, "base64url");
    altered[0] ^= 1;
    expect(() => secrets.decrypt([version, iv, altered.toString("base64url"), tag].join("."))).toThrow();
  });
});
