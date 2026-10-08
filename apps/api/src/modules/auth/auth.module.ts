import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module";
import { TokensModule } from "../tokens/tokens.module";
import { ActorMiddleware } from "./actor.middleware";
import { AuthController, DeviceController, LegacyGithubCallbackController } from "./auth.controller";
import { DeviceService } from "./device.service";
import { GithubLoginService } from "./github-login.service";
import { PasskeysService } from "./passkeys.service";
import { SessionsService } from "./sessions.service";
import { WsTicketsService } from "./ws-tickets.service";

/** Every route, root included, in the path syntax of Express 5. */
export const ALL_ROUTES = "{*splat}";

/**
 * The checks Traefik runs before each preview request: they carry the
 * preview's own headers, such as an Authorization header meant for the
 * application, so no actor is read from them.
 */
export const ROUTES_WITHOUT_ACTOR = [
  { path: "v1/auth/verify", method: RequestMethod.GET },
  { path: "v1/auth/verify-public", method: RequestMethod.GET },
];

@Module({
  imports: [TokensModule, SettingsModule],
  controllers: [AuthController, DeviceController, LegacyGithubCallbackController],
  providers: [ActorMiddleware, SessionsService, PasskeysService, GithubLoginService, DeviceService, WsTicketsService],
  exports: [SessionsService, PasskeysService, WsTicketsService],
})
export class AuthModule implements NestModule {
  /**
   * Every API route learns its actor, except the checks Traefik runs before
   * each preview request (ROUTES_WITHOUT_ACTOR).
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(ActorMiddleware)
      .exclude(...ROUTES_WITHOUT_ACTOR)
      .forRoutes(ALL_ROUTES);
  }
}
