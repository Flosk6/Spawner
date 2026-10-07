import { Controller, Get, Global, Module, Post } from "@nestjs/common";
import type { Actor } from "../../common/actor";
import { CurrentActor, Scopes } from "../../common/auth.guard";
import { AuditService } from "../audit/audit.service";
import { EngineModule } from "../engine/engine.module";
import { ActivityService } from "./activity.service";
import { CleanupService, type CleanupItem } from "./cleanup.service";
import { LifecycleService } from "./lifecycle.service";
import { ReconcileService } from "./reconcile.service";

const total = (items: CleanupItem[]) => items.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);

/**
 * The targeted cleanup, for the admins: what Spawner owns and no longer
 * needs.
 */
@Controller("v1/system/cleanup")
@Scopes("admin")
export class CleanupController {
  constructor(
    private readonly cleanup: CleanupService,
    private readonly audit: AuditService,
  ) {}

  /**
   * What can go: { items, totalBytes }. Automatic items go every minute
   * anyway; the others wait for an admin.
   */
  @Get()
  async scan() {
    const items = await this.cleanup.scan();
    return { items, totalBytes: total(items) };
  }

  /**
   * Removes everything the scan lists: { removed, failed, freedBytes }.
   */
  @Post()
  async run(@CurrentActor() actor: Actor) {
    const result = await this.cleanup.run({ all: true });
    await this.audit.record(actor, "system.cleanup", {
      details: { removed: result.removed.map((item) => `${item.kind} ${item.name}`).slice(0, 100), freedBytes: total(result.removed), failed: result.failed.length },
    });
    return { ...result, freedBytes: total(result.removed) };
  }
}

/**
 * The lifecycle of environments: activity, sleep after their idle time,
 * deletion once expired, reconciliation with Docker and targeted cleanup.
 */
@Global()
@Module({
  imports: [EngineModule],
  controllers: [CleanupController],
  providers: [ActivityService, LifecycleService, ReconcileService, CleanupService],
  exports: [ActivityService, CleanupService],
})
export class LifecycleModule {}
