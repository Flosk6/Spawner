import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "crypto";

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_DATA = 0x40;

interface StoredCredential {
  id: Buffer;
  rpId: string;
  userHandle: string;
  privateKey: KeyObject;
  counter: number;
}

/**
 * A passkey authenticator in software (P-256, attestation "none"), so tests
 * can register and log in without a browser: it answers the options the
 * server generates the way navigator.credentials does.
 */
export class SoftAuthenticator {
  readonly credentials: StoredCredential[] = [];

  register(options: PublicKeyCredentialCreationOptionsJSON, origin: string): RegistrationResponseJSON {
    const rpId = options.rp.id ?? new URL(origin).hostname;
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" });
    const coseKey = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x as string, "base64url")],
        [-3, Buffer.from(jwk.y as string, "base64url")],
      ]),
    );
    const id = randomBytes(16);
    const credentialIdLength = Buffer.alloc(2);
    credentialIdLength.writeUInt16BE(id.length);
    const authData = Buffer.concat([
      this.rpIdHash(rpId),
      Buffer.from([FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_ATTESTED_DATA]),
      this.counterBytes(0),
      Buffer.alloc(16),
      credentialIdLength,
      id,
      Buffer.from(coseKey),
    ]);
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]) as never);
    this.credentials.push({ id, rpId, userHandle: options.user.id, privateKey, counter: 0 });

    return {
      id: id.toString("base64url"),
      rawId: id.toString("base64url"),
      type: "public-key",
      response: {
        clientDataJSON: this.clientData("webauthn.create", options.challenge, origin),
        attestationObject: Buffer.from(attestationObject).toString("base64url"),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /**
   * Signs a login with the first credential of the relying party, or the
   * one given.
   */
  authenticate(options: PublicKeyCredentialRequestOptionsJSON, origin: string, credentialId?: string): AuthenticationResponseJSON {
    const rpId = options.rpId ?? new URL(origin).hostname;
    const credential = this.credentials.find((item) => item.rpId === rpId && (!credentialId || item.id.toString("base64url") === credentialId));
    if (!credential) {
      throw new Error(`no credential for ${rpId}`);
    }
    credential.counter += 1;
    const authenticatorData = Buffer.concat([this.rpIdHash(rpId), Buffer.from([FLAG_USER_PRESENT | FLAG_USER_VERIFIED]), this.counterBytes(credential.counter)]);
    const clientDataJSON = this.clientData("webauthn.get", options.challenge, origin);
    const clientDataHash = createHash("sha256").update(Buffer.from(clientDataJSON, "base64url")).digest();
    const signature = sign("sha256", Buffer.concat([authenticatorData, clientDataHash]), credential.privateKey);

    return {
      id: credential.id.toString("base64url"),
      rawId: credential.id.toString("base64url"),
      type: "public-key",
      response: {
        clientDataJSON,
        authenticatorData: authenticatorData.toString("base64url"),
        signature: signature.toString("base64url"),
        userHandle: credential.userHandle,
      },
      clientExtensionResults: {},
    };
  }

  private clientData(type: string, challenge: string, origin: string): string {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false })).toString("base64url");
  }

  private rpIdHash(rpId: string): Buffer {
    return createHash("sha256").update(rpId).digest();
  }

  private counterBytes(counter: number): Buffer {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(counter);
    return bytes;
  }
}
