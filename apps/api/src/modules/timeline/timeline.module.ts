import { Global, Module } from "@nestjs/common";
import { TimelineService } from "./timeline.service";

/**
 * The timeline of the environments, recorded by the engine (jobs) and the
 * supervision (Docker events).
 */
@Global()
@Module({
  providers: [TimelineService],
  exports: [TimelineService],
})
export class TimelineModule {}
