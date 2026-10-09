import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { credentialsPath, readCredentials } from "../config";
import { EXIT } from "../errors";
import { fakeFetch, reply, SERVER } from "../testing/fake-api";
import { tempDir } from "../testing/repo";
import { isWebUrl, login, machineName } from "./auth";

describe("login", () => {
  it("waits for the approval, then stores the token for its owner only", async () => {
    const env = { SPAWNER_CONFIG_DIR: tempDir() };
    const answers = [reply(400, { error: "authorization_pending" }), reply(400, { error: "slow_down" })];
    const shown: string[] = [];
    const result = await login(env, SERVER, {
      name: "claude-laptop",
      pollMs: 1,
      onCode: (code) => shown.push(code.userCode),
      fetch: fakeFetch({
        "GET /healthz": () => ({ status: "ok" }),
        "POST /auth/device": (request) => ({
          deviceCode: "device",
          userCode: "BCDF-GHJK",
          verificationUri: `${SERVER}/device`,
          verificationUriComplete: `${SERVER}/device?code=BCDF-GHJK`,
          expiresIn: 600,
          interval: 5,
          clientName: request.json.clientName,
        }),
        "POST /auth/device/token": () =>
          answers.shift() ?? { token: "spn_abcdefgh_secret", id: "t1", name: "claude-laptop", scopes: ["envs:read"], expiresAt: null, user: { id: 1, name: "Ada", role: "admin" } },
      }),
    });
    expect(shown).toEqual(["BCDF-GHJK"]);
    expect(result).toMatchObject({ server: SERVER, user: { name: "Ada" }, token: { id: "t1", name: "claude-laptop" } });
    const file = credentialsPath(env);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(readCredentials(file)).toMatchObject({ current: SERVER, servers: { [SERVER]: { token: "spn_abcdefgh_secret", tokenId: "t1" } } });
    expect(path.dirname(file)).toBe(env.SPAWNER_CONFIG_DIR);
  }, 20_000);

  it("stops when the login is denied", async () => {
    const promise = login({ SPAWNER_CONFIG_DIR: tempDir() }, SERVER, {
      pollMs: 1,
      onCode: () => undefined,
      fetch: fakeFetch({
        "GET /healthz": () => ({ status: "ok" }),
        "POST /auth/device": () => ({ deviceCode: "d", userCode: "X", verificationUri: "", verificationUriComplete: "", expiresIn: 600, interval: 5 }),
        "POST /auth/device/token": () => reply(400, { error: "access_denied" }),
      }),
    });
    await expect(promise).rejects.toMatchObject({ exit: EXIT.auth, code: "denied" });
  });

  it("refuses an address that is not a Spawner server", async () => {
    await expect(login({}, SERVER, { onCode: () => undefined, fetch: fakeFetch({}) })).rejects.toMatchObject({ code: "not_spawner" });
  });

  it("names tokens after the machine", () => {
    expect(machineName("Ada-MBP.local")).toBe("ada-mbp");
    expect(machineName("")).toBe("cli");
  });
});

describe("isWebUrl", () => {
  it("lets the CLI open http and https URLs only, whatever the server answers", () => {
    expect(isWebUrl("https://spawner.example.com/device")).toBe(true);
    expect(isWebUrl("http://spawner.localtest.me/device")).toBe(true);
    for (const url of ["file:///etc/passwd", "vscode://open?url=x", "javascript:alert(1)", "smb://host/share", "/device", ""]) {
      expect(isWebUrl(url)).toBe(false);
    }
  });
});
