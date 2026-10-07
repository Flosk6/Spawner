import { Module } from "@nestjs/common";
import { SystemStatsService } from "./system-stats.service";

/**
 * The memory guard of builds.
 */
@Module({
  providers: [SystemStatsService],
  exports: [SystemStatsService],
})
export class SystemModule {}
