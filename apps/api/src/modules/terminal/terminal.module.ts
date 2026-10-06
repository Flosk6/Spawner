import { Module } from '@nestjs/common';
import { TerminalGateway } from './terminal.gateway';
import { AuthModule } from '../auth/auth.module';
import { DockerService } from '../../common/docker.service';

@Module({
  imports: [AuthModule],
  providers: [TerminalGateway, DockerService],
})
export class TerminalModule {}
