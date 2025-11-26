import { Controller, Post, Body, Headers, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { UpdateService } from './update.service';
import * as crypto from 'crypto';

interface GitHubWebhookPayload {
  ref: string;
  repository: {
    full_name: string;
    clone_url: string;
  };
  head_commit: {
    id: string;
    message: string;
    timestamp: string;
    author: {
      name: string;
      email: string;
    };
  };
}

@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  private readonly WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
  private readonly AUTO_DEPLOY_ENABLED = process.env.AUTO_DEPLOY_ENABLED === 'true';
  private readonly AUTO_DEPLOY_BRANCH = process.env.AUTO_DEPLOY_BRANCH || 'main';

  constructor(private readonly updateService: UpdateService) {}

  @Post('github')
  async handleGitHubWebhook(
    @Headers('x-hub-signature-256') signature: string,
    @Headers('x-github-event') event: string,
    @Body() payload: GitHubWebhookPayload,
  ) {
    if (!this.WEBHOOK_SECRET) {
      throw new HttpException(
        'Webhook secret not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    if (!this.verifyGitHubSignature(signature, JSON.stringify(payload))) {
      this.logger.warn('Invalid webhook signature');
      throw new HttpException('Invalid signature', HttpStatus.UNAUTHORIZED);
    }

    this.logger.log(`Received GitHub webhook: ${event}`);

    if (event === 'push') {
      return this.handlePushEvent(payload);
    }

    if (event === 'ping') {
      return {
        success: true,
        message: 'Webhook configured successfully',
      };
    }

    return {
      success: true,
      message: `Event ${event} received but not processed`,
    };
  }

  private async handlePushEvent(payload: GitHubWebhookPayload) {
    const branch = payload.ref.replace('refs/heads/', '');

    this.logger.log(`Push to branch: ${branch}`);
    this.logger.log(`Commit: ${payload.head_commit.id.substring(0, 7)} - ${payload.head_commit.message}`);

    if (!this.AUTO_DEPLOY_ENABLED) {
      this.logger.log('Auto-deploy is disabled');
      return {
        success: true,
        message: 'Auto-deploy is disabled',
        branch,
        commit: payload.head_commit.id,
      };
    }

    if (branch !== this.AUTO_DEPLOY_BRANCH) {
      this.logger.log(`Branch ${branch} does not match auto-deploy branch ${this.AUTO_DEPLOY_BRANCH}`);
      return {
        success: true,
        message: `Branch ${branch} is not configured for auto-deploy`,
        branch,
        commit: payload.head_commit.id,
      };
    }

    this.logger.log(`Triggering auto-deploy for branch ${branch}`);

    setTimeout(async () => {
      try {
        await this.updateService.performUpdate('latest');
        this.logger.log('Auto-deploy completed successfully');
      } catch (error) {
        this.logger.error('Auto-deploy failed', error);
      }
    }, 1000);

    return {
      success: true,
      message: 'Auto-deploy triggered',
      branch,
      commit: payload.head_commit.id,
      commitMessage: payload.head_commit.message,
      author: payload.head_commit.author.name,
    };
  }

  private verifyGitHubSignature(signature: string, payload: string): boolean {
    if (!signature) {
      return false;
    }

    const hmac = crypto.createHmac('sha256', this.WEBHOOK_SECRET);
    const digest = 'sha256=' + hmac.update(payload).digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(digest),
    );
  }

  @Post('manual-deploy')
  async manualDeploy(
    @Headers('authorization') auth: string,
    @Body() body: { version?: string },
  ) {
    const token = auth?.replace('Bearer ', '');

    if (!token || token !== process.env.DEPLOY_TOKEN) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    this.logger.log(`Manual deploy triggered for version: ${body.version || 'latest'}`);

    setTimeout(async () => {
      try {
        await this.updateService.performUpdate(body.version);
        this.logger.log('Manual deploy completed successfully');
      } catch (error) {
        this.logger.error('Manual deploy failed', error);
      }
    }, 1000);

    return {
      success: true,
      message: 'Deploy triggered',
      version: body.version || 'latest',
    };
  }
}
