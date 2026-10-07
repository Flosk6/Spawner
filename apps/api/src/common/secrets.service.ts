import { Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { SpawnerConfig } from "./spawner.config";

const SECRET_FILE = "secret.key";

/** Claims every signed token carries: its expiry, in seconds since the epoch. */
export interface Expiring {
  exp: number;
}

/**
 * Server secrets. Every key derives (HKDF-SHA256) from one master secret:
 * SPAWNER_SECRET when it is set, or a random secret generated once into the
 * data directory (0600), which environments never mount.
 */
@Injectable()
export class SecretsService {
  private loaded: Buffer | null = null;

  constructor(private readonly config: SpawnerConfig) {}

  /** Read on first use, so commands that need no secret never touch the file. */
  private get master(): Buffer {
    this.loaded ??= this.config.secret ? Buffer.from(this.config.secret, "utf8") : loadOrCreateSecret(path.join(this.config.dataDir, SECRET_FILE));
    return this.loaded;
  }

  /**
   * A 32-byte key dedicated to one purpose: two purposes never share a key.
   */
  key(purpose: string): Buffer {
    return Buffer.from(hkdfSync("sha256", this.master, Buffer.alloc(0), `spawner:${purpose}`, 32));
  }

  /**
   * Signs claims into a compact token, `<payload>.<signature>` in base64url.
   * The purpose is part of the key, so a token made for one use is refused
   * for any other.
   */
  sign<T extends Expiring>(purpose: string, claims: T): string {
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${payload}.${this.mac(purpose, payload)}`;
  }

  /**
   * Returns the claims of a token signed for this purpose, or null when it
   * is malformed, forged or expired.
   */
  verify<T extends Expiring>(purpose: string, token: string | undefined): T | null {
    if (!token || token.length > 2048) {
      return null;
    }
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) {
      return null;
    }
    const expected = Buffer.from(this.mac(purpose, payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return null;
    }
    try {
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
      return typeof claims.exp === "number" && claims.exp > Date.now() / 1000 ? claims : null;
    } catch {
      return null;
    }
  }

  /**
   * Encrypts a secret setting (AES-256-GCM): `v1.<iv>.<ciphertext>.<tag>`.
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key("settings"), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return ["v1", iv, ciphertext, cipher.getAuthTag()].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
  }

  /**
   * Decrypts a value from encrypt().
   *
   * @throws When the value was altered or encrypted with another secret
   */
  decrypt(value: string): string {
    const [version, iv, ciphertext, tag] = value.split(".");
    if (version !== "v1" || !iv || !ciphertext || !tag) {
      throw new Error("not an encrypted value");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key("settings"), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  }

  private mac(purpose: string, payload: string): string {
    return createHmac("sha256", this.key(`token:${purpose}`)).update(payload).digest("base64url");
  }
}

/**
 * A random value for links and API tokens (base64url), and the SHA-256 that
 * is stored in its place.
 */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function loadOrCreateSecret(file: string): Buffer {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
  const secret = fs.readFileSync(file, "utf8").trim();
  if (secret.length < 32) {
    throw new Error(`${file} does not hold a usable secret`);
  }
  return Buffer.from(secret, "utf8");
}
