import { Controller, Get, Injectable, MiddlewareConsumer, Module, NestMiddleware, NestModule, Req } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Request } from "express";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_ROUTES, ROUTES_WITHOUT_ACTOR } from "./auth.module";

@Injectable()
class ActorProbe implements NestMiddleware {
  use(request: Request, _response: unknown, next: () => void) {
    request.headers["x-actor-read"] = "yes";
    next();
  }
}

@Controller("v1")
class ProbeController {
  @Get(["auth/verify", "auth/verify-public", "auth/whoami", "envs/:id"])
  probe(@Req() request: Request) {
    return request.headers["x-actor-read"] ?? "no";
  }
}

@Module({ controllers: [ProbeController], providers: [ActorProbe] })
class ProbeModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(ActorProbe)
      .exclude(...ROUTES_WITHOUT_ACTOR)
      .forRoutes(ALL_ROUTES);
  }
}

describe("the routes of the actor middleware, as AuthModule applies it", () => {
  let app: NestExpressApplication;
  let base: string;
  const warnings: string[] = [];

  beforeAll(async () => {
    const quiet = () => undefined;
    app = await NestFactory.create<NestExpressApplication>(ProbeModule, {
      logger: { log: quiet, error: quiet, debug: quiet, verbose: quiet, fatal: quiet, warn: (message: unknown) => warnings.push(String(message)) },
    });
    app.setGlobalPrefix("api");
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it("reads the actor of every API route, and never on the checks Traefik runs before preview requests", async () => {
    const read = async (path: string) => (await fetch(`${base}${path}`)).text();
    expect(await read("/api/v1/auth/whoami")).toBe("yes");
    expect(await read("/api/v1/envs/abc")).toBe("yes");
    expect(await read("/api/v1/auth/verify")).toBe("no");
    expect(await read("/api/v1/auth/verify?next=x")).toBe("no");
    expect(await read("/api/v1/auth/verify-public")).toBe("no");
    expect(warnings).toEqual([]);
  });
});
