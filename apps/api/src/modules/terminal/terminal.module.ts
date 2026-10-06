import { Module } from '@nestjs/common';
import { TerminalGateway } from './terminal.gateway';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [TerminalGateway],
})
export class TerminalModule {}
