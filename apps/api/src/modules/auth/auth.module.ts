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

@Module({
  imports: [TokensModule, SettingsModule],
  controllers: [AuthController, DeviceController, LegacyGithubCallbackController],
  providers: [ActorMiddleware, SessionsService, PasskeysService, GithubLoginService, DeviceService, WsTicketsService],
  exports: [SessionsService, PasskeysService, WsTicketsService],
})
export class AuthModule implements NestModule {
  /**
   * Every API route learns its actor, except the check Traefik runs before
   * each preview request: it carries the preview's own headers, such as an
   * Authorization header meant for the application.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ActorMiddleware).exclude({ path: "v1/auth/verify", method: RequestMethod.GET }).forRoutes("*");
  }
}
