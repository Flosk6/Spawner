import { Module } from "@nestjs/common";
import { SystemModule } from "../system/system.module";
import { ComposeRunner } from "./compose-runner.service";
import { GitKeysService } from "./git-keys.service";
import { GitMirrorService } from "./git-mirror.service";
import { JobLogsService } from "./job-logs.service";
import { JobQueueService } from "./job-queue.service";
import { LogArchiveService } from "./log-archive.service";
import { PipelineService } from "./pipeline.service";
import { RouterService } from "./router.service";
import { StorageService } from "./storage.service";
import { UploadService } from "./upload.service";

@Module({
  imports: [SystemModule],
  providers: [
    StorageService,
    GitKeysService,
    GitMirrorService,
    UploadService,
    ComposeRunner,
    RouterService,
    JobLogsService,
    LogArchiveService,
    PipelineService,
    JobQueueService,
  ],
  exports: [StorageService, GitKeysService, GitMirrorService, JobLogsService, JobQueueService, LogArchiveService],
})
export class EngineModule {}
