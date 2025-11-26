import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { INestApplicationContext, Logger } from '@nestjs/common';

export class SessionIoAdapter extends IoAdapter {
  private readonly logger = new Logger(SessionIoAdapter.name);
  private sessionMiddleware: any;

  constructor(app: INestApplicationContext, sessionMiddleware: any) {
    super(app);
    this.sessionMiddleware = sessionMiddleware;
  }

  createIOServer(port: number, options?: ServerOptions): any {
    this.logger.log('Creating Socket.IO server with session support');

    const server = super.createIOServer(port, options);

    // Wrap session middleware for Socket.IO
    server.use((socket: any, next: any) => {
      this.logger.debug(`Socket.IO connection from ${socket.handshake.address}`);
      this.logger.debug(`Cookies: ${JSON.stringify(socket.handshake.headers.cookie)}`);

      this.sessionMiddleware(socket.request, {}, (err: any) => {
        if (err) {
          this.logger.error(`Session middleware error: ${err}`);
          return next(err);
        }

        this.logger.debug(`Session ID: ${socket.request.session?.id}`);
        this.logger.debug(`Session passport: ${JSON.stringify(socket.request.session?.passport)}`);
        next();
      });
    });

    return server;
  }
}
