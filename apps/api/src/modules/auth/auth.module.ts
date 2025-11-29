import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';
import { GithubStrategy } from './strategies/github.strategy';
import { SessionSerializer } from './serialization/session.serializer';

@Module({
  imports: [
    PassportModule.register({ session: true }),
    ConfigModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthTokenService, GithubStrategy, SessionSerializer],
  exports: [AuthService, AuthTokenService],
})
export class AuthModule {}
