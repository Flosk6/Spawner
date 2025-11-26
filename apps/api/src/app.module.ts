import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { config } from "dotenv";
import { join } from "path";
import { ConfigModule } from "./config/config.module";
import { ProjectsModule } from "./modules/projects/projects.module";
import { GitModule } from "./modules/git/git.module";
import { EnvironmentModule } from "./modules/environment/environment.module";
import { Setting } from "./entities/setting.entity";
import { Environment } from "./entities/environment.entity";
import { EnvironmentResource } from "./entities/environment-resource.entity";
import { Project } from "./entities/project.entity";
import { ProjectResource } from "./entities/project-resource.entity";

// Load environment variables before module initialization
// Load from backend/.env when running from backend directory
config({ path: join(__dirname, "..", ".env") });

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: "sqlite",
      database: process.env.DATABASE_PATH || "/opt/spawner/data/spawner.db",
      entities: [
        Setting,
        Environment,
        EnvironmentResource,
        Project,
        ProjectResource,
      ],
      synchronize: true,
      logging: false,
    }),
    ConfigModule,
    ProjectsModule,
    GitModule,
    EnvironmentModule,
  ],
})
export class AppModule {}
