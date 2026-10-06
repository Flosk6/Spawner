import { Controller, DefaultValuePipe, Get, Global, Module, ParseIntPipe, Query } from "@nestjs/common";
import { Scopes } from "../../common/auth.guard";
import { AuditService } from "./audit.service";

@Controller("v1/audit")
@Scopes("admin")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query("before", new DefaultValuePipe(0), ParseIntPipe) before: number,
    @Query("action") action?: string,
  ) {
    return this.audit.list({ limit, before: before || undefined, action });
  }
}

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
