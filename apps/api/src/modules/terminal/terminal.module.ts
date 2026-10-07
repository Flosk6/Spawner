import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EngineModule } from "../engine/engine.module";
import { TerminalGateway } from "./terminal.gateway";
import { TerminalSessionsController, TerminalSessionsService } from "./terminal-sessions.service";

@Module({
  imports: [AuthModule, EngineModule],
  controllers: [TerminalSessionsController],
  providers: [TerminalGateway, TerminalSessionsService],
})
export class TerminalModule {}
