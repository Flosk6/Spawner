import { Controller, Get, Post, Body, Param, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { UpdateService } from './update.service';
import { SchedulerService } from './scheduler.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('system')
@UseGuards(AuthGuard('session'))
export class SystemController {
  constructor(
    private readonly updateService: UpdateService,
    private readonly schedulerService: SchedulerService,
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
}
