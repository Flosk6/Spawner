import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TerminalGateway } from './terminal.gateway';
import { Environment } from '../../entities/environment.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Environment]),
    AuthModule,
  ],
  providers: [TerminalGateway],
})
export class TerminalModule {}
