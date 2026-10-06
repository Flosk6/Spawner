import { Module } from '@nestjs/common';
import { SystemStatsService } from './system-stats.service';
import { SystemController } from './system.controller';
import { StatsModule } from '../stats/stats.module';

@Module({
  imports: [StatsModule],
  controllers: [SystemController],
  providers: [SystemStatsService],
  exports: [SystemStatsService],
})
export class SystemModule {}
