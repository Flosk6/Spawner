import { Global, Module } from "@nestjs/common";
import { SecretsService } from "./secrets.service";
import { SpawnerConfig } from "./spawner.config";

/** Settings from the environment and the secrets derived from them, for every module. */
@Global()
@Module({
  providers: [SpawnerConfig, SecretsService],
  exports: [SpawnerConfig, SecretsService],
})
export class SpawnerConfigModule {}
