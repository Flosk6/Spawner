import { Module } from "@nestjs/common";
import { EngineModule } from "../engine/engine.module";
import { GitController } from "./git.controller";

@Module({
  imports: [EngineModule],
  controllers: [GitController],
})
export class GitModule {}
