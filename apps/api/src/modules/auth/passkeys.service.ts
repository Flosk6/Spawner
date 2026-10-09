import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Passkey, Prisma, User } from "@prisma/client";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { Request } from "express";
import { PrismaService } from "../../common/prisma.service";
import { SpawnerConfig } from "../../common/spawner.config";

const RP_NAME = "Spawner";

/** A verified new passkey, ready to be stored for its user. */
export interface NewPasskey {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  deviceType: string;
  backedUp: boolean;
  /** User handle the authenticator stored, to keep on the user. */
  userHandle: string;
}

/**
 * WebAuthn ceremonies. The challenge lives in the session and serves once;
 * the relying party is the dashboard host the browser shows. Passkeys are
 * discoverable, so logging in needs no user name.
 */
@Injectable()
export class PasskeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SpawnerConfig,
  ) {}

  /**
   * Options for navigator.credentials.create().
   *
   * @param user - Name shown by the authenticator, user handle, passkeys to exclude
   * @param context - What the passkey is for ("account", "invite:<id>"); verifyRegistration must be given the same
   */
  async registrationOptions(
    request: Request,
    user: { name: string; userHandle: string; passkeys: Pick<Passkey, "id" | "transports">[] },
    context: string,
  ) {
    const origin = this.origin(request);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: new URL(origin).hostname,
      userName: user.name,
      userDisplayName: user.name,
      userID: isoBase64URL.toBuffer(user.userHandle),
      attestationType: "none",
      excludeCredentials: user.passkeys.map((passkey) => ({ id: passkey.id, transports: passkey.transports })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    request.session.webauthn = { challenge: options.challenge, purpose: "register", origin, userHandle: user.userHandle, context };
    return options;
  }

  /**
   * Checks the answer of navigator.credentials.create() against the
   * challenge in the session.
   */
  async verifyRegistration(request: Request, response: unknown, context: string): Promise<NewPasskey> {
    const pending = this.takePending(request, "register");
    if (pending.context !== context) {
      throw new BadRequestException("this passkey was prepared for something else: start again");
    }
    const result = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: pending.challenge,
      expectedOrigin: pending.origin,
      expectedRPID: new URL(pending.origin).hostname,
      requireUserVerification: true,
    }).catch((error: Error) => {
      throw new BadRequestException(`the passkey could not be verified: ${error.message}`);
    });
    if (!result.verified) {
      throw new BadRequestException("the passkey could not be verified");
    }
    const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
    return {
      id: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports ?? [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      userHandle: pending.userHandle as string,
    };
  }

  /**
   * Options for navigator.credentials.get(), for any passkey of the site.
   */
  async loginOptions(request: Request) {
    const origin = this.origin(request);
    const options = await generateAuthenticationOptions({ rpID: new URL(origin).hostname, userVerification: "required" });
    request.session.webauthn = { challenge: options.challenge, purpose: "login", origin };
    return options;
  }

  /**
   * Checks the answer of navigator.credentials.get() and returns the user
   * the passkey belongs to.
   */
  async verifyLogin(request: Request, response: unknown): Promise<User> {
    const pending = this.takePending(request, "login");
    const answer = response as AuthenticationResponseJSON;
    const passkey = typeof answer?.id === "string" ? await this.prisma.passkey.findUnique({ where: { id: answer.id }, include: { user: true } }) : null;
    if (!passkey) {
      throw new UnauthorizedException("this passkey is not known here");
    }
    const result = await verifyAuthenticationResponse({
      response: answer,
      expectedChallenge: pending.challenge,
      expectedOrigin: pending.origin,
      expectedRPID: new URL(pending.origin).hostname,
      credential: { id: passkey.id, publicKey: new Uint8Array(passkey.publicKey), counter: Number(passkey.counter), transports: passkey.transports },
      requireUserVerification: true,
    }).catch(() => ({ verified: false, authenticationInfo: null }));
    if (!result.verified) {
      throw new UnauthorizedException("the passkey could not be verified");
    }
    await this.prisma.passkey.update({
      where: { id: passkey.id },
      data: { counter: BigInt(result.authenticationInfo.newCounter), lastUsedAt: new Date() },
    });
    if (!passkey.user.isActive) {
      throw new ForbiddenException("this account is deactivated");
    }
    return passkey.user;
  }

  /**
   * Stores a verified passkey for a user, and the user handle the
   * authenticator received when the user had none yet.
   */
  async save(userId: number, passkey: NewPasskey, name: string, db: Prisma.TransactionClient = this.prisma): Promise<Passkey> {
    if (!(await db.user.findFirst({ where: { id: userId, webauthnId: { not: null } } }))) {
      await db.user.update({ where: { id: userId }, data: { webauthnId: passkey.userHandle } });
    }
    return db.passkey.create({
        data: {
          id: passkey.id,
          userId,
          name,
          publicKey: Buffer.from(passkey.publicKey),
          counter: BigInt(passkey.counter),
          transports: passkey.transports,
          deviceType: passkey.deviceType,
          backedUp: passkey.backedUp,
        },
    });
  }

  /**
   * The origin of the ceremony: the Origin header, when it is one of the
   * dashboard's. Passkeys are bound to it.
   */
  private origin(request: Request): string {
    const origin = request.headers.origin;
    if (typeof origin !== "string" || !this.config.dashboardOrigins.includes(origin)) {
      throw new BadRequestException(`passkeys only work on the dashboard (${this.config.dashboardUrl})`);
    }
    return origin;
  }

  private takePending(request: Request, purpose: "login" | "register") {
    const pending = request.session.webauthn;
    delete request.session.webauthn;
    if (!pending || pending.purpose !== purpose) {
      throw new BadRequestException("no passkey ceremony in progress: start again");
    }
    return pending;
  }
}
