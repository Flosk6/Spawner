import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { HealthController } from "../modules/health/health.module";
import { PreviewAuthController } from "../modules/previews/previews.module";
import { WakeController } from "../modules/previews/wake.controller";
import { NoThrottle, THROTTLERS } from "./throttler.guard";

/** What ThrottlerGuard reads to skip a limit: "THROTTLER:SKIP" followed by the limit's name. */
const skipped = (target: object, name: string) => Reflect.getMetadata(`THROTTLER:SKIP${name}`, target) === true;

describe("NoThrottle", () => {
  it("lifts every named limit, not only one called default", () => {
    class Routes {
      route() {}
    }
    NoThrottle()(Routes.prototype, "route", Object.getOwnPropertyDescriptor(Routes.prototype, "route")!);
    expect(THROTTLERS.map((throttler) => throttler.name)).toEqual(["short", "medium", "long"]);
    for (const { name } of THROTTLERS) {
      expect(skipped(Routes.prototype.route, name)).toBe(true);
    }
  });

  it("covers the routes Traefik calls for every request to a preview, the waiting page and the health checks", () => {
    const routes = [PreviewAuthController.prototype.verify, PreviewAuthController.prototype.verifyPublic, WakeController.prototype.wake];
    for (const { name } of THROTTLERS) {
      for (const route of routes) {
        expect(skipped(route, name), `${route.name} under "${name}"`).toBe(true);
      }
      expect(skipped(HealthController, name), `health under "${name}"`).toBe(true);
    }
  });
});
