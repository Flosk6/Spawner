import { Body, Controller, Get, Module, Put } from "@nestjs/common";
import type { Actor } from "../../common/actor";
import { CurrentActor, Scopes } from "../../common/auth.guard";
import { LimitsService } from "./limits.service";
import { SettingsService, type GithubSettingsInput } from "./settings.service";

@Controller("v1/settings")
@Scopes("admin")
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly limits: LimitsService,
  ) {}

  @Get("github")
  github() {
    return this.settings.githubView();
  }

  @Put("github")
  updateGithub(@CurrentActor() actor: Actor, @Body() body: GithubSettingsInput) {
    return this.settings.updateGithub(actor, body ?? {});
  }

  /**
   * Lifetimes, sleep, quotas, memory and build guards: { values, defaults,
   * overridden }.
   */
  @Get("limits")
  limitsView() {
    return this.limits.view();
  }

  /**
   * Changes some limits: { "idleSeconds": "30m", "envsPerUser": 3 }; null
   * goes back to what the environment of the server sets.
   */
  @Put("limits")
  updateLimits(@CurrentActor() actor: Actor, @Body() body: Record<string, unknown>) {
    return this.limits.update(actor, body ?? {});
  }
}

@Module({
  controllers: [SettingsController],
  providers: [SettingsService, LimitsService],
  exports: [SettingsService, LimitsService],
})
export class SettingsModule {}
