import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';
import { GithubStrategy } from './strategies/github.strategy';
import { SessionSerializer } from './serialization/session.serializer';
import { User } from '../../entities/user.entity';
import { AuditLog } from '../../entities/audit-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, AuditLog]),
    PassportModule.register({ session: true }),
    ConfigModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthTokenService, GithubStrategy, SessionSerializer],
  exports: [AuthService, AuthTokenService],
})
export class AuthModule {}
