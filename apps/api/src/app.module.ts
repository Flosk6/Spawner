import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { config } from "dotenv";
import { join } from "path";
import { ProjectsModule } from "./modules/projects/projects.module";
import { GitModule } from "./modules/git/git.module";
import { EnvironmentModule } from "./modules/environment/environment.module";
import { AuthModule } from "./modules/auth/auth.module";
import { TerminalModule } from "./modules/terminal/terminal.module";
import { SystemModule } from "./modules/system/system.module";
import { Setting } from "./entities/setting.entity";
import { Environment } from "./entities/environment.entity";
import { EnvironmentResource } from "./entities/environment-resource.entity";
import { Project } from "./entities/project.entity";
import { ProjectResource } from "./entities/project-resource.entity";
import { User } from "./entities/user.entity";
import { AuditLog } from "./entities/audit-log.entity";
import { SystemSetting } from "./entities/system-setting.entity";
import { ServerPatch } from "./entities/server-patch.entity";

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
    TypeOrmModule.forRoot({
      type: "postgres",
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "5432", 10),
      username: process.env.DB_USER || "spawner",
      password: process.env.DB_PASSWORD || "spawner",
      database: process.env.DB_NAME || "spawner",
      entities: [
        Setting,
        Environment,
        EnvironmentResource,
        Project,
        ProjectResource,
        User,
        AuditLog,
        SystemSetting,
        ServerPatch,
      ],
      synchronize: process.env.NODE_ENV !== "production",
      logging: process.env.DB_LOGGING === "true",
      migrations: [join(__dirname, "migrations", "*.{ts,js}")],
      migrationsRun: process.env.NODE_ENV === "production",
    }),
    ProjectsModule,
    GitModule,
    EnvironmentModule,
    AuthModule,
    TerminalModule,
    SystemModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
