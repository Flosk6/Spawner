import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { FirstAdminService } from "./first-admin.service";
import { InvitesService } from "./invites.service";
import { InvitesController, MeController, UsersController } from "./team.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [AuthModule, SettingsModule],
  controllers: [InvitesController, UsersController, MeController],
  providers: [InvitesService, UsersService, FirstAdminService],
  exports: [InvitesService],
})
export class TeamModule {}
