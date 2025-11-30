import { Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { ScheduleModule } from "@nestjs/schedule";
import { APP_GUARD } from "@nestjs/core";
import { config } from "dotenv";
import { join } from "path";
import { PrismaModule } from "./common/prisma.module";
import { ProjectsModule } from "./modules/projects/projects.module";
import { GitModule } from "./modules/git/git.module";
import { EnvironmentModule } from "./modules/environment/environment.module";
import { AuthModule } from "./modules/auth/auth.module";
import { TerminalModule } from "./modules/terminal/terminal.module";
import { SystemModule } from "./modules/system/system.module";
import { StatsModule } from "./modules/stats/stats.module";

// Load environment variables before module initialization
// Load from root .env (centralized configuration)
const envPath = join(__dirname, "..", "..", "..", ".env");
config({ path: envPath });

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: envPath,
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: "short",
        ttl: 1000,
        limit: 3,
      },
      {
        name: "medium",
        ttl: 10000,
        limit: 20,
      },
      {
        name: "long",
        ttl: 60000,
        limit: 100,
      },
    ]),
    PrismaModule,
    ProjectsModule,
    GitModule,
    EnvironmentModule,
    AuthModule,
    TerminalModule,
    SystemModule,
    StatsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
