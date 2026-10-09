import { BadRequestException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaService } from "../../common/prisma.service";
import { randomToken } from "../../common/secrets.service";
import type { SpawnerConfig } from "../../common/spawner.config";
import { SoftAuthenticator } from "../../testing/soft-authenticator";
import { PasskeysService } from "./passkeys.service";

const ORIGIN = "https://spawner.preview.example.com";

interface StoredPasskey {
  id: string;
  userId: number;
  name: string;
  publicKey: Buffer;
  counter: bigint;
  transports: string[];
}

/** The few Prisma calls of PasskeysService, on two in-memory tables. */
function fakePrisma(users: { id: number; name: string; isActive: boolean; webauthnId: string | null }[]) {
  const passkeys = new Map<string, StoredPasskey>();
  const prisma = {
    passkeys,
    user: {
      findFirst: async ({ where }: { where: { id: number } }) => users.find((user) => user.id === where.id && user.webauthnId !== null) ?? null,
      update: async ({ where, data }: { where: { id: number }; data: { webauthnId: string } }) => Object.assign(users.find((user) => user.id === where.id)!, data),
    },
    passkey: {
      create: async ({ data }: { data: StoredPasskey }) => {
        passkeys.set(data.id, data);
        return data;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const passkey = passkeys.get(where.id);
        return passkey ? { ...passkey, user: users.find((user) => user.id === passkey.userId) } : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<StoredPasskey> }) => Object.assign(passkeys.get(where.id)!, data),
    },
  };
  return prisma;
}

describe("PasskeysService", () => {
  let users: { id: number; name: string; isActive: boolean; webauthnId: string | null }[];
  let prisma: ReturnType<typeof fakePrisma>;
  let service: PasskeysService;
  let authenticator: SoftAuthenticator;
  let request: Request;

  beforeEach(() => {
    users = [{ id: 1, name: "Ada", isActive: true, webauthnId: null }];
    prisma = fakePrisma(users);
    service = new PasskeysService(prisma as unknown as PrismaService, { dashboardOrigins: [ORIGIN], dashboardUrl: ORIGIN } as SpawnerConfig);
    authenticator = new SoftAuthenticator();
    request = { headers: { origin: ORIGIN }, session: {} } as unknown as Request;
  });

  async function register(context = "account") {
    const options = await service.registrationOptions(request, { name: "Ada", userHandle: randomToken(16), passkeys: [] }, context);
    const passkey = await service.verifyRegistration(request, authenticator.register(options, ORIGIN), context);
    await service.save(1, passkey, "Laptop");
    return passkey;
  }

  async function login() {
    const options = await service.loginOptions(request);
    return service.verifyLogin(request, authenticator.authenticate(options, ORIGIN));
  }

  it("registers a passkey for the dashboard host, then logs its user in", async () => {
    const passkey = await register();

    expect(prisma.passkeys.get(passkey.id)?.name).toBe("Laptop");
    expect(users[0].webauthnId).toBe(passkey.userHandle);
    expect((await login()).id).toBe(1);
    expect(prisma.passkeys.get(passkey.id)?.counter).toBe(1n);
  });

  it("serves each challenge once", async () => {
    await register();
    const options = await service.loginOptions(request);
    const answer = authenticator.authenticate(options, ORIGIN);
    await service.verifyLogin(request, answer);

    await expect(service.verifyLogin(request, answer)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses a passkey prepared for something else", async () => {
    const options = await service.registrationOptions(request, { name: "Ada", userHandle: randomToken(16), passkeys: [] }, "invite:abc");

    await expect(service.verifyRegistration(request, authenticator.register(options, ORIGIN), "account")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses ceremonies outside the dashboard", async () => {
    const elsewhere = { headers: { origin: "https://evil--app.preview.example.com" }, session: {} } as unknown as Request;

    await expect(service.loginOptions(elsewhere)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses an answer signed for another origin", async () => {
    await register();
    const options = await service.loginOptions(request);

    await expect(service.verifyLogin(request, authenticator.authenticate(options, "https://other.example.com"))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("asks for the user's verification, and refuses a passkey or a login without it", async () => {
    expect((await service.loginOptions(request)).userVerification).toBe("required");
    authenticator.userVerified = false;
    const options = await service.registrationOptions(request, { name: "Ada", userHandle: randomToken(16), passkeys: [] }, "account");
    expect(options.authenticatorSelection?.userVerification).toBe("required");
    await expect(service.verifyRegistration(request, authenticator.register(options, ORIGIN), "account")).rejects.toThrow(/user could not be verified/i);

    authenticator.userVerified = true;
    await register();
    authenticator.userVerified = false;
    await expect(login()).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("refuses unknown passkeys and deactivated users", async () => {
    const options = await service.loginOptions(request);
    const stranger = new SoftAuthenticator();
    stranger.register(await service.registrationOptions({ headers: { origin: ORIGIN }, session: {} } as unknown as Request, { name: "x", userHandle: randomToken(16), passkeys: [] }, "account"), ORIGIN);
    await expect(service.verifyLogin(request, stranger.authenticate(options, ORIGIN))).rejects.toBeInstanceOf(UnauthorizedException);

    await register();
    users[0].isActive = false;
    await expect(login()).rejects.toBeInstanceOf(ForbiddenException);
  });
});
