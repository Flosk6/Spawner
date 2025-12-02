import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { UpdateService } from './update.service';
import { SchedulerService } from './scheduler.service';
import { SystemController } from './system.controller';
import { WebhookController } from './webhook.controller';
import { DockerService } from '../../common/docker.service';
import { PrismaService } from '../../common/prisma.service';
import { StatsModule } from '../stats/stats.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    StatsModule,
  ],
  controllers: [SystemController, WebhookController],
  providers: [UpdateService, SchedulerService, DockerService, PrismaService],
  exports: [UpdateService, SchedulerService],
})
export class SystemModule {}
