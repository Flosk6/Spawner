import { Body, Controller, Get, Module, Put } from "@nestjs/common";
import type { Actor } from "../../common/actor";
import { CurrentActor, Scopes } from "../../common/auth.guard";
import { SettingsService, type GithubSettingsInput } from "./settings.service";

@Controller("v1/settings")
@Scopes("admin")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get("github")
  github() {
    return this.settings.githubView();
  }

  @Put("github")
  updateGithub(@CurrentActor() actor: Actor, @Body() body: GithubSettingsInput) {
    return this.settings.updateGithub(actor, body ?? {});
  }
}

@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
