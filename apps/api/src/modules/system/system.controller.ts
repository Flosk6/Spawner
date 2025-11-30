import { Controller, Get, Post, Body, Param, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { UpdateService } from './update.service';
import { SchedulerService } from './scheduler.service';
import { AuthGuard } from '@nestjs/passport';
import { DockerService } from '../../common/docker.service';

@Controller('system')
@UseGuards(AuthGuard('session'))
export class SystemController {
  constructor(
    private readonly updateService: UpdateService,
    private readonly schedulerService: SchedulerService,
    private readonly dockerService: DockerService,
  ) {}

  @Get('updates/check')
  async checkForUpdates() {
    try {
      const updateInfo = await this.updateService.checkForUpdates();
      return {
        success: true,
        data: updateInfo,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to check for updates', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('updates/apply')
  async applyUpdate(@Body() body: { version?: string }) {
    try {
      await this.updateService.performUpdate(body.version);
      return {
        success: true,
        message: 'Update applied successfully. Please allow a few minutes for the service to restart.',
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to apply update', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('version')
  async getVersion() {
    try {
      const currentVersion = await this.updateService.getInstalledVersion();
      const latestVersion = await this.updateService.getSetting('LATEST_VERSION');

      return {
        success: true,
        data: {
          current: currentVersion,
          latest: latestVersion || currentVersion,
        },
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to get version', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('patches')
  async getPendingPatches() {
    try {
      const patches = await this.updateService.getPendingPatches();
      return {
        success: true,
        data: patches,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to get patches', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('patches/check')
  async checkSystemPackages() {
    try {
      const updates = await this.updateService.checkSystemPackages();
      return {
        success: true,
        message: `Found ${updates.length} package updates`,
        data: updates,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to check system packages', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('patches/:id/apply')
  async applyPatch(@Param('id') id: number) {
    try {
      await this.updateService.applyPatch(id);
      return {
        success: true,
        message: 'Patch applied successfully',
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to apply patch', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('patches/apply-all')
  async applyAllPatches() {
    try {
      await this.updateService.applyAllPatches();
      return {
        success: true,
        message: 'All patches applied successfully',
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to apply patches', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('settings')
  async getSettings() {
    try {
      const autoUpdateEnabled = await this.updateService.getSetting('AUTO_UPDATE_ENABLED');
      const updateCheckCron = await this.updateService.getSetting('UPDATE_CHECK_CRON');
      const autoUpdateCron = await this.updateService.getSetting('AUTO_UPDATE_CRON');

      return {
        success: true,
        data: {
          autoUpdateEnabled: autoUpdateEnabled === 'true',
          updateCheckCron: updateCheckCron || '0 * * * *',
          autoUpdateCron: autoUpdateCron || '0 0 * * *',
        },
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to get settings', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('settings')
  async updateSettings(@Body() body: {
    autoUpdateEnabled?: boolean;
    updateCheckCron?: string;
    autoUpdateCron?: string;
  }) {
    try {
      await this.schedulerService.updateConfiguration(body);
      return {
        success: true,
        message: 'Settings updated successfully',
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to update settings', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('docker/stats')
  async getDockerStats() {
    try {
      const stats = await this.dockerService.getSystemDiskUsage();
      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to get Docker stats', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('docker/prune-images')
  async pruneImages() {
    try {
      const result = await this.dockerService.pruneImages(true);
      return {
        success: true,
        message: 'Dangling images pruned successfully',
        data: result,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to prune images', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('docker/prune-cache')
  async pruneBuildCache() {
    try {
      const result = await this.dockerService.pruneBuildCache();
      return {
        success: true,
        message: 'Build cache pruned successfully',
        data: result,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to prune build cache', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('docker/prune-volumes')
  async pruneVolumes() {
    try {
      const result = await this.dockerService.pruneVolumes();
      return {
        success: true,
        message: 'Unused volumes pruned successfully',
        data: result,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to prune volumes', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('docker/prune-containers')
  async pruneContainers() {
    try {
      const result = await this.dockerService.pruneContainers();
      return {
        success: true,
        message: 'Stopped containers pruned successfully',
        data: result,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to prune containers', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('docker/prune-networks')
  async pruneNetworks() {
    try {
      const result = await this.dockerService.pruneNetworks();
      return {
        success: true,
        message: 'Unused networks pruned successfully',
        data: result,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to prune networks', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('docker/prune-all')
  async pruneAll() {
    try {
      const images = await this.dockerService.pruneImages(true);
      const containers = await this.dockerService.pruneContainers();
      const volumes = await this.dockerService.pruneVolumes();
      const networks = await this.dockerService.pruneNetworks();
      const cache = await this.dockerService.pruneBuildCache();

      return {
        success: true,
        message: 'Full system cleanup completed',
        data: {
          images,
          containers,
          volumes,
          networks,
          cache,
        },
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to perform full cleanup', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('docker/images')
  async listImages() {
    try {
      const images = await this.dockerService.listAllImages();
      return {
        success: true,
        data: images,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to list images', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('docker/containers')
  async listContainers() {
    try {
      const containers = await this.dockerService.listAllContainers();
      return {
        success: true,
        data: containers,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to list containers', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('docker/volumes')
  async listVolumes() {
    try {
      const volumes = await this.dockerService.listAllVolumes();
      return {
        success: true,
        data: volumes,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to list volumes', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('docker/networks')
  async listNetworks() {
    try {
      const networks = await this.dockerService.listAllNetworks();
      return {
        success: true,
        data: networks,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to list networks', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('docker/images/remove')
  async removeImages(@Body() body: { imageIds: string[]; force?: boolean }) {
    try {
      const results = [];
      const images = await this.dockerService.listAllImages();

      for (const imageId of body.imageIds) {
        try {
          const imageInfo = images.find(img => img.Id === imageId);
          const isDangling = imageInfo?.isDangling || false;
          const force = body.force || isDangling;

          await this.dockerService.removeImageById(imageId, force);
          results.push({ imageId, success: true });
        } catch (error) {
          results.push({ imageId, success: false, error: error.message });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failedCount = results.filter(r => !r.success).length;

      return {
        success: true,
        message: `Removed ${successCount} of ${body.imageIds.length} images${failedCount > 0 ? ` (${failedCount} failed)` : ''}`,
        data: results,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to remove images', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('docker/containers/remove')
  async removeContainers(@Body() body: { containerIds: string[] }) {
    try {
      const results = [];
      for (const containerId of body.containerIds) {
        try {
          await this.dockerService.removeContainer(containerId, true);
          results.push({ containerId, success: true });
        } catch (error) {
          results.push({ containerId, success: false, error: error.message });
        }
      }
      return {
        success: true,
        message: `Removed ${results.filter(r => r.success).length} of ${body.containerIds.length} containers`,
        data: results,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to remove containers', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('docker/volumes/remove')
  async removeVolumes(@Body() body: { volumeNames: string[] }) {
    try {
      const results = [];
      for (const volumeName of body.volumeNames) {
        try {
          await this.dockerService.removeVolumeByName(volumeName);
          results.push({ volumeName, success: true });
        } catch (error) {
          results.push({ volumeName, success: false, error: error.message });
        }
      }
      return {
        success: true,
        message: `Removed ${results.filter(r => r.success).length} of ${body.volumeNames.length} volumes`,
        data: results,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to remove volumes', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('docker/networks/remove')
  async removeNetworks(@Body() body: { networkIds: string[] }) {
    try {
      const results = [];
      for (const networkId of body.networkIds) {
        try {
          await this.dockerService.removeNetworkById(networkId);
          results.push({ networkId, success: true });
        } catch (error) {
          results.push({ networkId, success: false, error: error.message });
        }
      }
      return {
        success: true,
        message: `Removed ${results.filter(r => r.success).length} of ${body.networkIds.length} networks`,
        data: results,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to remove networks', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('docker/intelligent-cleanup')
  async intelligentCleanup(@Body() body?: {
    imageDaysThreshold?: number;
    containerDaysThreshold?: number;
    cacheDaysThreshold?: number;
  }) {
    try {
      const result = await this.dockerService.intelligentCleanup(body);
      return {
        success: true,
        message: `Intelligent cleanup completed: ${result.images.removed} images, ${result.containers.removed} containers removed`,
        data: result,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Intelligent cleanup failed', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
