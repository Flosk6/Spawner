import { Controller, Get, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SystemStatsService } from './system-stats.service';
import { PrismaService } from '../../common/prisma.service';
import { StatsService } from '../stats/stats.service';
import { execSync } from 'child_process';

@Controller('system')
@UseGuards(AuthGuard('session'))
export class SystemController {
  constructor(
    private readonly systemStatsService: SystemStatsService,
    private readonly prisma: PrismaService,
    private readonly statsService: StatsService,
  ) {}

  @Get('host/stats')
  async getHostStats() {
    try {
      const memoryStats = this.systemStatsService.getMemoryStats();
      const cpuInfo = this.systemStatsService.getCpuInfo();
      const systemInfo = this.systemStatsService.getSystemInfo();

      let diskStats = { total: 0, used: 0, free: 0 };
      try {
        const platform = systemInfo.platform;

        if (platform === 'darwin') {
          const dfOutput = execSync('df -k / | tail -1').toString();
          const parts = dfOutput.split(/\s+/).filter((p: string) => p);

          const totalBlocks = parseInt(parts[1]);
          const availableBlocks = parseInt(parts[3]);
          const usedBlocks = totalBlocks - availableBlocks;

          diskStats = {
            total: totalBlocks * 1024,
            used: usedBlocks * 1024,
            free: availableBlocks * 1024,
          };
        } else {
          const dfOutput = execSync('df -B1 / | tail -1').toString();
          const parts = dfOutput.split(/\s+/).filter((p: string) => p);

          diskStats = {
            total: parseInt(parts[1]),
            used: parseInt(parts[2]),
            free: parseInt(parts[3]),
          };
        }
      } catch (error) {
        console.error('Failed to get disk stats:', error.message);
      }

      return {
        success: true,
        data: {
          cpu: cpuInfo,
          memory: {
            total: memoryStats.total,
            used: memoryStats.used,
            free: memoryStats.free,
            usagePercent: memoryStats.usagePercent,
          },
          disk: {
            total: diskStats.total,
            used: diskStats.used,
            free: diskStats.free,
            usagePercent: diskStats.total > 0 ? Math.round((diskStats.used / diskStats.total) * 100 * 10) / 10 : 0,
          },
          uptime: systemInfo.uptime,
          hostname: systemInfo.hostname,
          platform: systemInfo.platform,
          arch: systemInfo.arch,
        },
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to get host stats', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('spawner/environments-stats')
  async getSpawnerEnvironmentsStats() {
    try {
      const environments = await this.prisma.environment.findMany({
        where: {
          status: 'running',
        },
        include: {
          project: true,
        },
      });

      const environmentsWithStats = await Promise.all(
        environments.map(async (env) => {
          const latestStats = await this.statsService.getLatestStats(env.id);

          if (!latestStats) {
            return {
              id: env.id,
              name: env.name,
              projectName: env.project?.name || 'Unknown',
              containers: [],
              totalCpu: 0,
              totalMemoryUsage: 0,
              totalMemoryLimit: 0,
            };
          }

          return {
            id: env.id,
            name: env.name,
            projectName: env.project?.name || 'Unknown',
            containers: latestStats.containers.map((c: any) => ({
              name: c.name,
              cpuPercent: Number(c.cpuPercent),
              memoryUsage: Number(c.memoryUsageGB) * 1024 * 1024 * 1024,
              memoryLimit: Number(c.memoryLimitGB) * 1024 * 1024 * 1024,
              memoryPercent: Number(c.memoryLimitGB) > 0
                ? Math.round((Number(c.memoryUsageGB) / Number(c.memoryLimitGB)) * 100 * 10) / 10
                : 0,
            })),
            totalCpu: Number(latestStats.cpuPercent),
            totalMemoryUsage: Number(latestStats.memoryUsageGB) * 1024 * 1024 * 1024,
            totalMemoryLimit: Number(latestStats.memoryLimitGB) * 1024 * 1024 * 1024,
          };
        })
      );

      const totalStats = environmentsWithStats.reduce(
        (acc, env) => ({
          cpu: acc.cpu + env.totalCpu,
          memoryUsage: acc.memoryUsage + env.totalMemoryUsage,
          memoryLimit: acc.memoryLimit + env.totalMemoryLimit,
          containerCount: acc.containerCount + env.containers.length,
        }),
        { cpu: 0, memoryUsage: 0, memoryLimit: 0, containerCount: 0 }
      );

      return {
        success: true,
        data: {
          environments: environmentsWithStats,
          total: {
            environmentCount: environmentsWithStats.length,
            containerCount: totalStats.containerCount,
            totalCpu: Math.round(totalStats.cpu * 10) / 10,
            totalMemoryUsage: totalStats.memoryUsage,
            totalMemoryLimit: totalStats.memoryLimit,
            totalMemoryPercent:
              totalStats.memoryLimit > 0
                ? Math.round((totalStats.memoryUsage / totalStats.memoryLimit) * 100 * 10) / 10
                : 0,
          },
        },
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to get Spawner environments stats', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
