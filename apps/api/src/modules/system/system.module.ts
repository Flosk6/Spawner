import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { UpdateService } from './update.service';
import { SchedulerService } from './scheduler.service';
import { SystemController } from './system.controller';
import { WebhookController } from './webhook.controller';
import { DockerService } from '../../common/docker.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
  ],
  controllers: [SystemController, WebhookController],
  providers: [UpdateService, SchedulerService, DockerService],
  exports: [UpdateService, SchedulerService],
})
export class SystemModule {}
