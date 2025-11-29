import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { UpdateService } from './update.service';
import { SchedulerService } from './scheduler.service';
import { SystemController } from './system.controller';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
  ],
  controllers: [SystemController, WebhookController],
  providers: [UpdateService, SchedulerService],
  exports: [UpdateService, SchedulerService],
})
export class SystemModule {}
