import { Controller, Get, Module, Res } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Response } from "express";
import * as fs from "fs";
import type { AddressInfo } from "net";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import { dashboardPolicy, serveWebApp } from "../web-app";
import { FRAME_HEADERS, frameHeaders, securityHeaders } from "./frame-headers";

const OWN_POLICY = "default-src 'none'; frame-ancestors 'none'";

@Controller("v1")
class ProbeController {
  @Get("probe")
  probe() {
    return { ok: true };
  }

  @Get("own-policy")
  ownPolicy(@Res() response: Response) {
    response.setHeader("Content-Security-Policy", OWN_POLICY);
    response.status(503).send("waiting");
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe("frameHeaders", () => {
  it("sets both headers, then hands the request on", () => {
    const headers = new Map<string, string>();
    const response = { setHeader: (name: string, value: string) => headers.set(name, value) };
    const next = vi.fn();
    frameHeaders({} as never, response as never, next);
    expect(Object.fromEntries(headers)).toEqual({ "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'" });
    expect(next).toHaveBeenCalledOnce();
  });

  it("comes with Referrer-Policy and nosniff, and Strict-Transport-Security over HTTPS only", () => {
    for (const https of [true, false]) {
      const headers = new Map<string, string>();
      const next = vi.fn();
      securityHeaders({ https })({} as never, { setHeader: (name: string, value: string) => headers.set(name, value) } as never, next);
      expect(Object.fromEntries(headers)).toEqual({
        ...FRAME_HEADERS,
        "Referrer-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
        ...(https ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
      });
      expect(next).toHaveBeenCalledOnce();
    }
  });

  it("gives the dashboard a policy that allows its inline scripts by their hashes only", () => {
    const script = "\n      document.documentElement.classList.add('dark');\n    ";
    const policy = dashboardPolicy(`<head><script>${script}</script><script type="module" src="/assets/app.js"></script></head>`);
    expect(policy).toContain(`script-src 'self' 'sha256-${createHash("sha256").update(script).digest("base64")}';`);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("unsafe-eval");
    expect(dashboardPolicy("<head></head>")).toContain("script-src 'self';");
  });

  describe("registered before the web app, as main.ts does", () => {
    let app: NestExpressApplication;
    let base: string;
    let web: string;

    beforeAll(async () => {
      web = fs.mkdtempSync(path.join(os.tmpdir(), "spawner-web-"));
      fs.mkdirSync(path.join(web, "assets"));
      fs.writeFileSync(path.join(web, "index.html"), "<!doctype html><title>Spawner</title><script>theme()</script>");
      fs.writeFileSync(path.join(web, "assets", "app.js"), "console.log(1)");
      vi.stubEnv("WEB_DIST_PATH", web);
      app = await NestFactory.create<NestExpressApplication>(ProbeModule, { logger: false });
      app.use(frameHeaders);
      serveWebApp(app);
      app.setGlobalPrefix("api");
      await app.listen(0, "127.0.0.1");
      base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await app?.close();
      vi.unstubAllEnvs();
      fs.rmSync(web, { recursive: true, force: true });
    });

    it.each([
      ["a static file", "/assets/app.js", 200],
      ["the single-page app", "/device", 200],
      ["an API route", "/api/v1/probe", 200],
      ["an unknown API route", "/api/v1/nope", 404],
    ])("covers %s", async (_what, url, status) => {
      const response = await fetch(`${base}${url}`);
      expect(response.status).toBe(status);
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    });

    it("serves the dashboard's page with its own policy, which keeps it out of frames", async () => {
      const response = await fetch(`${base}/device`);
      expect(response.headers.get("Content-Security-Policy")).toBe(dashboardPolicy("<script>theme()</script>"));
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    });

    it("lets a page with its own policy replace it", async () => {
      const response = await fetch(`${base}/api/v1/own-policy`);
      expect(response.headers.get("Content-Security-Policy")).toBe(OWN_POLICY);
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    });
  });
});
