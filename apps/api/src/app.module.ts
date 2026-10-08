import { Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule } from "@nestjs/throttler";
import { config } from "dotenv";
import { join } from "path";
import { AuthGuard } from "./common/auth.guard";
import { DockerModule } from "./common/docker.module";
import { PrismaModule } from "./common/prisma.module";
import { SpawnerConfigModule } from "./common/spawner-config.module";
import { ActorThrottlerGuard, THROTTLERS } from "./common/throttler.guard";
import { AuditModule } from "./modules/audit/audit.module";
import { AuthModule } from "./modules/auth/auth.module";
import { EnvironmentsModule } from "./modules/environments/environments.module";
import { GitModule } from "./modules/git/git.module";
import { HealthModule } from "./modules/health/health.module";
import { MetaModule } from "./modules/meta/meta.module";
import { PreviewsModule } from "./modules/previews/previews.module";
import { ProjectsModule } from "./modules/projects/projects.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { LifecycleModule } from "./modules/lifecycle/lifecycle.module";
import { SupervisionModule } from "./modules/supervision/supervision.module";
import { UpdatesModule } from "./modules/updates/updates.module";
import { SystemModule } from "./modules/system/system.module";
import { TeamModule } from "./modules/team/team.module";
import { TerminalModule } from "./modules/terminal/terminal.module";
import { TimelineModule } from "./modules/timeline/timeline.module";
import { TokensModule } from "./modules/tokens/tokens.module";

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
    // Per user (see ActorThrottlerGuard), on each route; login routes have tighter limits.
    ThrottlerModule.forRoot(THROTTLERS),
    SpawnerConfigModule,
    PrismaModule,
    DockerModule,
    AuditModule,
    TimelineModule,
    LifecycleModule,
    TokensModule,
    SettingsModule,
    AuthModule,
    TeamModule,
    ProjectsModule,
    GitModule,
    EnvironmentsModule,
    PreviewsModule,
    TerminalModule,
    SystemModule,
    SupervisionModule,
    UpdatesModule,
    HealthModule,
    MetaModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ActorThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
