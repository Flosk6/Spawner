import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UpdateService } from './update.service';

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  private autoUpdateEnabled: boolean = false;
  private updateCheckCron: string = CronExpression.EVERY_HOUR;
  private autoUpdateCron: string = '0 0 * * *';

  constructor(private readonly updateService: UpdateService) {}

  async onModuleInit() {
    await this.loadConfiguration();
  }

  private async loadConfiguration() {
    try {
      const autoUpdate = await this.updateService.getSetting('AUTO_UPDATE_ENABLED');
      this.autoUpdateEnabled = autoUpdate === 'true';

      const checkCron = await this.updateService.getSetting('UPDATE_CHECK_CRON');
      if (checkCron) {
        this.updateCheckCron = checkCron;
      }

      const updateCron = await this.updateService.getSetting('AUTO_UPDATE_CRON');
      if (updateCron) {
        this.autoUpdateCron = updateCron;
      }

      this.logger.log(`Scheduler configured: autoUpdate=${this.autoUpdateEnabled}, checkCron=${this.updateCheckCron}, updateCron=${this.autoUpdateCron}`);
    } catch (error) {
      this.logger.error('Failed to load scheduler configuration', error);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async checkForUpdates() {
    try {
      this.logger.log('Running scheduled update check');
      const updateInfo = await this.updateService.checkForUpdates();

      if (updateInfo.updateAvailable) {
        this.logger.log(`Update available: ${updateInfo.currentVersion} -> ${updateInfo.latestVersion}`);
      } else {
        this.logger.log('No updates available');
      }
    } catch (error) {
      this.logger.error('Scheduled update check failed', error);
    }
  }

  @Cron('0 0 * * *')
  async performAutoUpdate() {
    try {
      await this.loadConfiguration();

      if (!this.autoUpdateEnabled) {
        this.logger.log('Auto-update is disabled, skipping');
        return;
      }

      this.logger.log('Running scheduled auto-update');

      const updateInfo = await this.updateService.checkForUpdates();
      if (updateInfo.updateAvailable) {
        this.logger.log(`Applying update: ${updateInfo.currentVersion} -> ${updateInfo.latestVersion}`);
        await this.updateService.performUpdate(updateInfo.latestVersion);
        this.logger.log('Auto-update completed successfully');
      } else {
        this.logger.log('Already up to date');
      }
    } catch (error) {
      this.logger.error('Auto-update failed', error);
    }
  }

  @Cron('0 0 * * 0')
  async checkSystemPatches() {
    try {
      this.logger.log('Running weekly system package check');
      const updates = await this.updateService.checkSystemPackages();

      if (updates.length > 0) {
        this.logger.log(`Found ${updates.length} package updates`);
        const securityUpdates = updates.filter(u => u.type === 'security');
        if (securityUpdates.length > 0) {
          this.logger.warn(`Found ${securityUpdates.length} SECURITY updates`);
        }
      } else {
        this.logger.log('System packages are up to date');
      }
    } catch (error) {
      this.logger.error('System package check failed', error);
    }
  }

  async updateConfiguration(config: {
    autoUpdateEnabled?: boolean;
    updateCheckCron?: string;
    autoUpdateCron?: string;
  }) {
    if (config.autoUpdateEnabled !== undefined) {
      this.autoUpdateEnabled = config.autoUpdateEnabled;
      await this.updateService['saveSetting']('AUTO_UPDATE_ENABLED', String(config.autoUpdateEnabled));
    }

    if (config.updateCheckCron) {
      this.updateCheckCron = config.updateCheckCron;
      await this.updateService['saveSetting']('UPDATE_CHECK_CRON', config.updateCheckCron);
    }

    if (config.autoUpdateCron) {
      this.autoUpdateCron = config.autoUpdateCron;
      await this.updateService['saveSetting']('AUTO_UPDATE_CRON', config.autoUpdateCron);
    }

    this.logger.log('Scheduler configuration updated');
  }
}
