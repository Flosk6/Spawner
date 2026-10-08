import { Controller, Get, Module, Res } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Response } from "express";
import * as fs from "fs";
import type { AddressInfo } from "net";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { serveWebApp } from "../web-app";
import { FRAME_HEADERS, frameHeaders } from "./frame-headers";

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

  describe("registered before the web app, as main.ts does", () => {
    let app: NestExpressApplication;
    let base: string;
    let web: string;

    beforeAll(async () => {
      web = fs.mkdtempSync(path.join(os.tmpdir(), "spawner-web-"));
      fs.mkdirSync(path.join(web, "assets"));
      fs.writeFileSync(path.join(web, "index.html"), "<!doctype html><title>Spawner</title>");
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
      for (const [name, value] of Object.entries(FRAME_HEADERS)) {
        expect(response.headers.get(name)).toBe(value);
      }
    });

    it("lets a page with its own policy replace it", async () => {
      const response = await fetch(`${base}/api/v1/own-policy`);
      expect(response.headers.get("Content-Security-Policy")).toBe(OWN_POLICY);
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    });
  });
});
