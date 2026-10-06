#!/usr/bin/env node
// Plays an invited teammate for scripts/e2e-engine.sh, with Node built-ins
// only: accepts an invitation with a passkey (a software authenticator, as a
// browser would with navigator.credentials), logs in again with it, logs a
// CLI in through the device flow, then opens a protected preview through the
// dashboard. Fails with a message on the first unexpected answer.
//
// Usage: node scripts/e2e/teammate.mjs <invitation url> <preview url> <environment id>
// Environment: SPAWNER_API (http://127.0.0.1:8080), SPAWNER_DASHBOARD (http://spawner.localtest.me),
//              SPAWNER_HTTP (http://127.0.0.1:80, where Traefik listens)

import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import http from "node:http";

const API = process.env.SPAWNER_API ?? "http://127.0.0.1:8080";
const DASHBOARD = process.env.SPAWNER_DASHBOARD ?? "http://spawner.localtest.me";
const TRAEFIK = process.env.SPAWNER_HTTP ?? "http://127.0.0.1:80";
const [inviteUrl, previewUrl, environmentId] = process.argv.slice(2);
if (!inviteUrl || !previewUrl || !environmentId) {
  console.error("usage: node scripts/e2e/teammate.mjs <invitation url> <preview url> <environment id>");
  process.exit(2);
}

const cookies = new Map();

/** One HTTP request; host, cookies and the client header handled like a browser on the dashboard. */
function request(base, method, path, { host, body, headers = {}, jar = true } = {}) {
  const target = new URL(path, base);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const cookieHeader = jar ? [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") : "";
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method,
        headers: {
          host: host ?? target.host,
          origin: DASHBOARD,
          "x-spawner-client": "e2e",
          ...(payload ? { "content-type": "application/json" } : {}),
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
          ...headers,
        },
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => {
          if (jar) {
            for (const line of [res.headers["set-cookie"] ?? []].flat()) {
              const [pair] = line.split(";");
              const index = pair.indexOf("=");
              cookies.set(pair.slice(0, index), pair.slice(index + 1));
            }
          }
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

function expect(condition, message, answer) {
  if (!condition) {
    console.error(`FAIL: ${message}${answer ? ` (got ${answer.status}: ${answer.text.slice(0, 300)})` : ""}`);
    process.exit(1);
  }
}

const ok = (message) => console.log(`\x1b[32mok\x1b[0m ${message}`);

// --- A software passkey authenticator (P-256, attestation "none") ---

function cborHead(major, length) {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 256) return Buffer.from([(major << 5) | 24, length]);
  const bytes = Buffer.alloc(3);
  bytes[0] = (major << 5) | 25;
  bytes.writeUInt16BE(length, 1);
  return bytes;
}

function cbor(value) {
  if (value instanceof Map) return Buffer.concat([cborHead(5, value.size), ...[...value].flatMap(([key, item]) => [cbor(key), cbor(item)])]);
  if (Buffer.isBuffer(value)) return Buffer.concat([cborHead(2, value.length), value]);
  if (typeof value === "string") return Buffer.concat([cborHead(3, Buffer.byteLength(value)), Buffer.from(value)]);
  if (Number.isInteger(value)) return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  throw new Error(`cannot encode ${typeof value}`);
}

const authenticator = { credential: null };

function clientData(type, challenge) {
  return Buffer.from(JSON.stringify({ type, challenge, origin: DASHBOARD, crossOrigin: false })).toString("base64url");
}

function register(options) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const coseKey = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]));
  const id = randomBytes(16);
  const idLength = Buffer.alloc(2);
  idLength.writeUInt16BE(id.length);
  const authData = Buffer.concat([createHash("sha256").update(options.rp.id).digest(), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), idLength, id, coseKey]);
  authenticator.credential = { id, rpId: options.rp.id, userHandle: options.user.id, privateKey, counter: 0 };
  return {
    id: id.toString("base64url"),
    rawId: id.toString("base64url"),
    type: "public-key",
    response: {
      clientDataJSON: clientData("webauthn.create", options.challenge),
      attestationObject: cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]])).toString("base64url"),
      transports: ["internal"],
    },
    clientExtensionResults: {},
  };
}

function authenticate(options) {
  const credential = authenticator.credential;
  credential.counter += 1;
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(credential.counter);
  const authenticatorData = Buffer.concat([createHash("sha256").update(options.rpId).digest(), Buffer.from([0x05]), counter]);
  const clientDataJSON = clientData("webauthn.get", options.challenge);
  const signed = Buffer.concat([authenticatorData, createHash("sha256").update(Buffer.from(clientDataJSON, "base64url")).digest()]);
  return {
    id: credential.id.toString("base64url"),
    rawId: credential.id.toString("base64url"),
    type: "public-key",
    response: {
      clientDataJSON,
      authenticatorData: authenticatorData.toString("base64url"),
      signature: sign("sha256", signed, credential.privateKey).toString("base64url"),
      userHandle: credential.userHandle,
    },
    clientExtensionResults: {},
  };
}

// --- The teammate ---

const token = new URL(inviteUrl).pathname.split("/invite/")[1];
const invite = await request(API, "GET", `/api/v1/invites/open/${token}`);
expect(invite.status === 200 && invite.json.role === "member", "the invitation is readable", invite);

const creation = await request(API, "POST", `/api/v1/invites/open/${token}/passkey-options`, { body: { name: "Grace" } });
expect(creation.status === 201, "passkey options for the invitation", creation);
const accepted = await request(API, "POST", `/api/v1/invites/open/${token}/accept`, { body: { name: "Grace", credential: register(creation.json), passkeyName: "e2e" } });
expect(accepted.status === 201 && accepted.json.user.name === "Grace", "the invitation creates the account", accepted);
const again = await request(API, "POST", `/api/v1/invites/open/${token}/accept`, { body: { name: "Mallory" } });
expect(again.status === 404, "an invitation works once", again);
ok("the invitation created Grace's account with a passkey");

cookies.clear();
const anonymous = await request(API, "GET", "/api/v1/auth/session");
expect(anonymous.json?.user === null, "logged out without the session cookie", anonymous);
const loginOptions = await request(API, "POST", "/api/v1/auth/passkey/options");
const login = await request(API, "POST", "/api/v1/auth/passkey", { body: { credential: authenticate(loginOptions.json) } });
expect(login.status === 201 && login.json.user.name === "Grace", "the passkey logs Grace in", login);
const session = await request(API, "GET", "/api/v1/auth/session");
expect(session.json?.user?.role === "member", "the session knows Grace", session);
ok("Grace logs in with her passkey");

const forged = await request(API, "POST", "/api/v1/tokens", { body: { name: "forged" }, headers: { "x-spawner-client": "" } });
expect(forged.status === 403, "a change without the client header is refused (CSRF)", forged);
ok("a request carrying only the session cookie cannot change anything");

const device = await request(API, "POST", "/api/v1/auth/device", { body: { clientName: "e2e-laptop" }, jar: false });
expect(device.status === 201 && /^[A-Z]{4}-[A-Z]{4}$/.test(device.json.userCode), "the CLI gets a device code", device);
const pending = await request(API, "POST", "/api/v1/auth/device/token", { body: { deviceCode: device.json.deviceCode }, jar: false });
expect(pending.status === 400 && pending.json.error === "authorization_pending", "the CLI waits for approval", pending);
const approval = await request(API, "POST", "/api/v1/auth/device/approve", { body: { userCode: device.json.userCode.toLowerCase(), approve: true } });
expect(approval.status === 201, "Grace approves the CLI login", approval);
const granted = await request(API, "POST", "/api/v1/auth/device/token", { body: { deviceCode: device.json.deviceCode }, jar: false });
expect(granted.status === 201 && granted.json.token?.startsWith("spn_"), "the CLI receives its token", granted);
const cli = { authorization: `Bearer ${granted.json.token}` };
const listed = await request(API, "GET", "/api/v1/envs", { headers: cli, jar: false });
expect(listed.status === 200 && listed.json.some((environment) => environment.id === environmentId), "the token lists the environments", listed);
const foreignExec = await request(API, "POST", `/api/v1/envs/${environmentId}/exec`, { headers: cli, body: { service: "db", argv: ["true"] }, jar: false });
expect(foreignExec.status === 403, "a member cannot run commands in someone else's environment", foreignExec);
ok("the CLI logged in through the device flow, with Grace's rights only");

const preview = new URL(previewUrl);
const viaTraefik = (path, extra = {}) => request(TRAEFIK, "GET", path, { host: preview.host, headers: { accept: "text/html", ...extra }, jar: false });
const bounced = await viaTraefik("/");
expect(bounced.status === 302 && bounced.headers.location.startsWith(`${DASHBOARD}/api/v1/auth/preview?next=`), "an anonymous visitor goes to the dashboard", bounced);
const handoff = await request(API, "GET", new URL(bounced.headers.location).pathname + new URL(bounced.headers.location).search);
expect(handoff.status === 302 && handoff.headers.location === previewUrl, "the dashboard sends Grace back to the preview", handoff);
const previewCookie = [handoff.headers["set-cookie"] ?? []].flat().find((line) => line.startsWith("spawner_preview="));
expect(previewCookie?.includes("Domain=localtest.me") || previewCookie?.includes("Domain="), "the dashboard sets the preview cookie on the preview domain", handoff);
const page = await viaTraefik("/", { cookie: previewCookie.split(";")[0] });
expect(page.status === 200 && page.text.includes("Hello"), "Grace opens the protected preview", page);
ok("Grace opens the protected preview through the dashboard");
