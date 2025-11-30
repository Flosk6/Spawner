import { Module } from "@nestjs/common";
import { StatsService } from "./stats.service";
import { PrismaService } from "../../common/prisma.service";
import { DockerService } from "../../common/docker.service";

@Module({
  providers: [StatsService, PrismaService, DockerService],
  exports: [StatsService],
})
export class StatsModule {}
