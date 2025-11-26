import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

interface WsTokenData {
  userId: number;
  username: string;
  expiresAt: number;
}

@Injectable()
export class AuthTokenService {
  private readonly logger = new Logger(AuthTokenService.name);
  // Store temporary WebSocket tokens (in production, use Redis)
  private wsTokens = new Map<string, WsTokenData>();

  constructor() {
    // Clean up expired tokens every minute
    setInterval(() => {
      const now = Date.now();
      for (const [token, data] of this.wsTokens.entries()) {
        if (data.expiresAt < now) {
          this.wsTokens.delete(token);
        }
      }
    }, 60000);
  }

  generateWsToken(userId: number, username: string): { token: string; expiresAt: number } {
    // Generate a temporary token (valid for 30 seconds)
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 30000; // 30 seconds

    this.wsTokens.set(token, {
      userId,
      username,
      expiresAt,
    });

    this.logger.debug(`Generated WebSocket token for user ${username} (${userId})`);

    return { token, expiresAt };
  }

  validateWsToken(token: string): { userId: number; username: string } | null {
    const data = this.wsTokens.get(token);
    if (!data) {
      this.logger.warn(`Invalid token attempted: ${token.substring(0, 10)}...`);
      return null;
    }

    if (data.expiresAt < Date.now()) {
      this.logger.warn(`Expired token attempted for user ${data.username}`);
      this.wsTokens.delete(token);
      return null;
    }

    // Delete token after use (one-time use)
    this.wsTokens.delete(token);

    this.logger.debug(`Validated WebSocket token for user ${data.username} (${data.userId})`);

    return { userId: data.userId, username: data.username };
  }
}
