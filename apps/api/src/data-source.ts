import { DataSource } from "typeorm";
import { config } from "dotenv";
import { join } from "path";
import { Setting } from "./entities/setting.entity";
import { Environment } from "./entities/environment.entity";
import { EnvironmentResource } from "./entities/environment-resource.entity";
import { Project } from "./entities/project.entity";
import { ProjectResource } from "./entities/project-resource.entity";
import { User } from "./entities/user.entity";
import { AuditLog } from "./entities/audit-log.entity";
import { SystemSetting } from "./entities/system-setting.entity";
import { ServerPatch } from "./entities/server-patch.entity";

// Load .env from root (3 levels up from apps/api/src/)
config({ path: join(__dirname, "..", "..", "..", ".env") });

export const AppDataSource = new DataSource({
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
  migrations: [join(__dirname, "migrations", "*.{ts,js}")],
  synchronize: false,
  logging: false,
});
