import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { randomBytes } from "crypto";
import { diskStorage } from "multer";
import { EngineModule } from "../engine/engine.module";
import { SpawnerConfig } from "../../common/spawner.config";
import { StorageService } from "../engine/storage.service";
import { StatsModule } from "../stats/stats.module";
import { EnvironmentsController } from "./environments.controller";
import { EnvironmentsService } from "./environments.service";
import { JobsController } from "./jobs.controller";

@Module({
  imports: [
    EngineModule,
    StatsModule,
    MulterModule.registerAsync({
      imports: [EngineModule],
      inject: [SpawnerConfig, StorageService],
      useFactory: (config: SpawnerConfig, storage: StorageService) => ({
        storage: diskStorage({
          destination: storage.uploadsDir,
          filename: (_request, _file, callback) => callback(null, `${Date.now()}-${randomBytes(8).toString("hex")}.tar.gz`),
        }),
        limits: { fileSize: config.uploadMaxBytes, files: 11, fields: 10, fieldSize: 64 * 1024 },
      }),
    }),
  ],
  controllers: [EnvironmentsController, JobsController],
  providers: [EnvironmentsService],
})
export class EnvironmentsModule {}
