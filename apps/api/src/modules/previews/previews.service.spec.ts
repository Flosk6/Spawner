import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it } from "vitest";
import * as os from "os";
import { sessionActor } from "../../common/actor";
import type { PrismaService } from "../../common/prisma.service";
import { SecretsService, sha256 } from "../../common/secrets.service";
import type { SpawnerConfig } from "../../common/spawner.config";
import { ActivityService } from "../lifecycle/activity.service";
import { PreviewsService, applicationCookies, parseCookies, type PreviewRequest } from "./previews.service";

const config = {
  scheme: "https",
  previewDomain: "preview.example.com",
  dashboardUrl: "https://spawner.preview.example.com",
  dataDir: os.tmpdir(),
  secret: "a test secret that is long enough",
} as SpawnerConfig;

const HOST = "feat-login--blog.preview.example.com";
const OTHER_HOST = "main--blog.preview.example.com";

describe("PreviewsService", () => {
  let secrets: SecretsService;
  let service: PreviewsService;
  let activity: string[];
  let activeUsers: Set<number>;
  let shares: { id: string; tokenHash: string; environmentId: string; expiresAt: Date; revokedAt: Date | null }[];

  beforeEach(() => {
    secrets = new SecretsService(config);
    activity = [];
    activeUsers = new Set([7]);
    shares = [];
    const prisma = {
      exposure: {
        findFirst: async ({ where }: { where: { host: string } }) => ({ [HOST]: { environmentId: "env-a" }, [OTHER_HOST]: { environmentId: "env-b" } })[where.host] ?? null,
      },
      user: { findUnique: async ({ where }: { where: { id: number } }) => ({ isActive: activeUsers.has(where.id) }) },
      shareLink: {
        findUnique: async ({ where }: { where: { tokenHash?: string; id?: string } }) =>
          shares.find((share) => (where.tokenHash ? share.tokenHash === where.tokenHash : share.id === where.id)) ?? null,
      },
      environment: { update: async ({ where }: { where: { id: string } }) => activity.push(where.id) },
    };
    service = new PreviewsService(prisma as unknown as PrismaService, secrets, config, new ActivityService(prisma as unknown as PrismaService));
  });

  const request = (overrides: Partial<PreviewRequest> = {}): PreviewRequest => ({
    method: "GET",
    proto: "https",
    host: HOST,
    uri: "/dashboard?tab=1",
    accept: "text/html,application/xhtml+xml",
    cookies: {},
    header: undefined,
    ...overrides,
  });
  const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

  it("sends a browser without credentials to the dashboard, and answers 401 to other clients", async () => {
    const browser = await service.decide(request());
    expect(browser).toEqual({
      status: 302,
      location: `https://spawner.preview.example.com/api/v1/auth/preview?next=${encodeURIComponent(`https://${HOST}/dashboard?tab=1`)}`,
    });

    const api = await service.decide(request({ accept: "application/json" }));
    expect(api).toMatchObject({ status: 401, body: { error: "preview_auth_required" } });
    expect(await service.decide(request({ method: "POST" }))).toMatchObject({ status: 401 });
  });

  it("lets CORS preflights through without counting them as activity, and no other OPTIONS request", async () => {
    const preflight = { method: "OPTIONS", accept: "*/*", origin: "https://app.example.com", preflightMethod: "POST" };
    expect(await service.decide(request(preflight))).toEqual({ status: 200, environmentId: "env-a" });
    expect(activity).toEqual([]);

    expect(await service.decide(request({ ...preflight, origin: undefined }))).toMatchObject({ status: 401 });
    expect(await service.decide(request({ ...preflight, preflightMethod: undefined }))).toMatchObject({ status: 401 });
  });

  it("lets the team in with the preview cookie, while its user is active", async () => {
    const cookie = secrets.sign("preview-cookie", { exp: inAnHour(), sub: 7 });
    expect(await service.decide(request({ cookies: { spawner_preview: cookie } }))).toEqual({ status: 200, environmentId: "env-a" });

    const other = secrets.sign("preview-cookie", { exp: inAnHour(), sub: 8 });
    expect(await service.decide(request({ cookies: { spawner_preview: other } }))).toMatchObject({ status: 302 });
  });

  it("accepts the agents' header for its environment only", async () => {
    const header = secrets.sign("preview-header", { exp: inAnHour(), sub: 7, env: "env-a" });
    expect(await service.decide(request({ header }))).toMatchObject({ status: 200 });
    expect(await service.decide(request({ header, host: OTHER_HOST, accept: "*/*" }))).toMatchObject({ status: 401 });
    expect(await service.decide(request({ header: secrets.sign("preview-cookie", { exp: inAnHour(), sub: 7 }), accept: "*/*" }))).toMatchObject({ status: 401 });
  });

  it("turns a share link into a cookie for that environment, and removes it from the URL", async () => {
    shares.push({ id: "s1", tokenHash: sha256("share-token"), environmentId: "env-a", expiresAt: new Date(Date.now() + 3_600_000), revokedAt: null });

    const decision = await service.decide(request({ uri: "/dashboard?tab=1&__spawner_share=share-token" }));
    expect(decision).toMatchObject({ status: 302, location: `https://${HOST}/dashboard?tab=1` });
    const cookie = (decision as { cookie: string }).cookie;
    expect(cookie).toMatch(/^spawner_share_env-a=[^;]+; Domain=preview\.example\.com; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax; Secure$/);

    const cookies = parseCookies(cookie.split(";")[0]);
    expect(await service.decide(request({ cookies }))).toMatchObject({ status: 200 });
    expect(await service.decide(request({ cookies, host: OTHER_HOST }))).toMatchObject({ status: 302, location: expect.stringContaining("/api/v1/auth/preview") });
  });

  it("ignores share links that expired, were revoked or belong to another environment", async () => {
    const soon = new Date(Date.now() + 3_600_000);
    shares.push(
      { id: "s1", tokenHash: sha256("expired"), environmentId: "env-a", expiresAt: new Date(Date.now() - 1000), revokedAt: null },
      { id: "s2", tokenHash: sha256("revoked"), environmentId: "env-a", expiresAt: soon, revokedAt: new Date() },
      { id: "s3", tokenHash: sha256("elsewhere"), environmentId: "env-b", expiresAt: soon, revokedAt: null },
    );
    for (const token of ["expired", "revoked", "elsewhere", "unknown"]) {
      expect(await service.decide(request({ uri: `/?__spawner_share=${token}` }))).toMatchObject({ status: 302, location: expect.stringContaining("/api/v1/auth/preview") });
    }
  });

  it("closes a share cookie as soon as its link is revoked, and refuses cookies that name no link", async () => {
    shares.push({ id: "s1", tokenHash: sha256("share-token"), environmentId: "env-a", expiresAt: new Date(Date.now() + 3_600_000), revokedAt: null });
    const decision = await service.decide(request({ uri: "/?__spawner_share=share-token" }));
    const cookies = parseCookies((decision as { cookie: string }).cookie.split(";")[0]);
    expect(await service.decide(request({ cookies }))).toMatchObject({ status: 200 });

    shares[0].revokedAt = new Date();
    service.forgetShare("s1");
    expect(await service.decide(request({ cookies }))).toMatchObject({ status: 302, location: expect.stringContaining("/api/v1/auth/preview") });

    const older = { "spawner_share_env-a": secrets.sign("share", { exp: inAnHour(), env: "env-a" }) };
    expect(await service.decide(request({ cookies: older }))).toMatchObject({ status: 302, location: expect.stringContaining("/api/v1/auth/preview") });
  });

  it("records activity at most once a minute per environment", async () => {
    const header = secrets.sign("preview-header", { exp: inAnHour(), env: "env-a" });
    await service.decide(request({ header }));
    await service.decide(request({ header }));

    expect(activity).toEqual(["env-a"]);
  });

  it("knows only the hosts of live environments", async () => {
    expect(await service.decide(request({ host: "unknown--x.preview.example.com" }))).toMatchObject({ status: 404 });
  });

  it("gives the team cookie to logged-in users and only sends them back to previews", () => {
    const actor = sessionActor({ id: 7, name: "Ada", role: "member" });
    const { cookie, next } = service.previewCookie(actor, `https://${HOST}/page`);

    expect(next).toBe(`https://${HOST}/page`);
    expect(cookie).toMatch(/^spawner_preview=[^;]+; Domain=preview\.example\.com; Path=\/; Max-Age=432\d\d; HttpOnly; SameSite=Lax; Secure$/);
    for (const next of ["https://evil.example.com/", "http://feat--blog.preview.example.com/", "https://preview.example.com.evil.com/", "javascript:alert(1)"]) {
      expect(() => service.previewCookie(actor, next)).toThrow(BadRequestException);
    }
  });
});

describe("parseCookies", () => {
  it("reads a Cookie header", () => {
    expect(parseCookies("a=1; spawner_preview=x.y; b = 2")).toEqual({ a: "1", spawner_preview: "x.y", b: "2" });
    expect(parseCookies(undefined)).toEqual({});
  });
});

describe("applicationCookies", () => {
  it("keeps the application's cookies and drops Spawner's", () => {
    expect(applicationCookies("theme=dark; spawner_preview=x.y; spawner_share_env1=z; laravel_session=abc")).toBe("theme=dark; laravel_session=abc");
    expect(applicationCookies("spawner_preview=x.y; spawner_share_env1=z")).toBeNull();
    expect(applicationCookies(undefined)).toBeNull();
    expect(applicationCookies("a=1;;  ; b=2")).toBe("a=1; b=2");
  });
});
