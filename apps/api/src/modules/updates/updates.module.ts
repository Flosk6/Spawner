import { Controller, Get, HttpCode, Module, Post } from "@nestjs/common";
import type { Actor } from "../../common/actor";
import { CurrentActor, Scopes } from "../../common/auth.guard";
import { UpdatesService } from "./updates.service";

/**
 * Updates of Spawner from the dashboard, for the admins.
 */
@Controller("v1/system/update")
@Scopes("admin")
export class UpdatesController {
  constructor(private readonly updates: UpdatesService) {}

  /**
   * The version running, the newest one available, whether this server can
   * update itself, and the last update.
   */
  @Get()
  status() {
    return this.updates.status();
  }

  /**
   * Reads the list of releases now, then answers like GET.
   */
  @Post("check")
  @HttpCode(200)
  async check() {
    await this.updates.check();
    return this.updates.status();
  }

  /**
   * Updates Spawner to the newest version (202): Spawner backs its database
   * up, then restarts on the new version, or goes back to this one.
   */
  @Post()
  @HttpCode(202)
  start(@CurrentActor() actor: Actor) {
    return this.updates.start(actor);
  }
}

@Module({
  controllers: [UpdatesController],
  providers: [UpdatesService],
})
export class UpdatesModule {}
