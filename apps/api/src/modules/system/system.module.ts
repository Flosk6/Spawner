import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { SystemSetting } from '../../entities/system-setting.entity';
import { ServerPatch } from '../../entities/server-patch.entity';
import { UpdateService } from './update.service';
import { SchedulerService } from './scheduler.service';
import { SystemController } from './system.controller';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([SystemSetting, ServerPatch]),
    ScheduleModule.forRoot(),
  ],
  controllers: [SystemController, WebhookController],
  providers: [UpdateService, SchedulerService],
  exports: [UpdateService, SchedulerService],
})
export class SystemModule {}
