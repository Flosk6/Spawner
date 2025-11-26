import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';

@Injectable()
export class WsSessionAuthGuard implements CanActivate {
  private readonly logger = new Logger(WsSessionAuthGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient();
    const request = client.request || client.handshake;

    this.logger.debug(`Session data: ${JSON.stringify(request?.session)}`);
    this.logger.debug(`Passport user: ${JSON.stringify(request?.session?.passport?.user)}`);

    if (!request?.session?.passport?.user) {
      this.logger.warn('No authenticated user in session');
      throw new WsException('Unauthorized');
    }

    // Attach user to handshake for easy access in gateway
    client.handshake.user = request.session.passport.user;

    return true;
  }
}
