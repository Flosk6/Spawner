import { Controller, Get, Module, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../../common/auth.guard";
import { PrismaService } from "../../common/prisma.service";
import { NoThrottle } from "../../common/throttler.guard";

@Controller("v1")
@Public()
@NoThrottle()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** The process answers. */
  @Get("healthz")
  healthz() {
    return { status: "ok" };
  }

  /** The process answers and reaches its database. */
  @Get("readyz")
  async readyz() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok" };
    } catch {
      throw new ServiceUnavailableException({ status: "database unreachable" });
    }
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
