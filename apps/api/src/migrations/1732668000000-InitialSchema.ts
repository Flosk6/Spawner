import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1732668000000 implements MigrationInterface {
  name = "InitialSchema1732668000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create users table
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" SERIAL NOT NULL,
        "githubId" character varying NOT NULL,
        "username" character varying NOT NULL,
        "email" character varying,
        "avatarUrl" character varying,
        "role" character varying NOT NULL DEFAULT 'user',
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "lastLoginAt" TIMESTAMP,
        CONSTRAINT "UQ_users_githubId" UNIQUE ("githubId"),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);

    // Create audit_logs table
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" SERIAL NOT NULL,
        "userId" integer,
        "action" character varying NOT NULL,
        "details" text,
        "ipAddress" character varying,
        "userAgent" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id")
      )
    `);

    // Create settings table
    await queryRunner.query(`
      CREATE TABLE "settings" (
        "id" SERIAL NOT NULL,
        "key" character varying NOT NULL,
        "value" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_settings_key" UNIQUE ("key"),
        CONSTRAINT "PK_settings" PRIMARY KEY ("id")
      )
    `);

    // Create projects table
    await queryRunner.query(`
      CREATE TABLE "projects" (
        "id" SERIAL NOT NULL,
        "name" character varying NOT NULL,
        "baseDomain" character varying NOT NULL,
        "config" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_projects_name" UNIQUE ("name"),
        CONSTRAINT "PK_projects" PRIMARY KEY ("id")
      )
    `);

    // Create project_resources table
    await queryRunner.query(`
      CREATE TABLE "project_resources" (
        "id" SERIAL NOT NULL,
        "projectId" integer NOT NULL,
        "resourceName" character varying NOT NULL,
        "resourceType" character varying NOT NULL,
        "gitRepo" character varying,
        "defaultBranch" character varying,
        "dbResource" character varying,
        "apiResource" character varying,
        "config" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_project_resources" PRIMARY KEY ("id")
      )
    `);

    // Create environments table
    await queryRunner.query(`
      CREATE TABLE "environments" (
        "id" SERIAL NOT NULL,
        "name" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'creating',
        "projectId" integer NOT NULL,
        "configJson" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_environments" PRIMARY KEY ("id")
      )
    `);

    // Create environment_resources table
    await queryRunner.query(`
      CREATE TABLE "environment_resources" (
        "id" SERIAL NOT NULL,
        "environmentId" integer NOT NULL,
        "resourceName" character varying NOT NULL,
        "resourceType" character varying NOT NULL,
        "branch" character varying,
        "url" character varying,
        "status" character varying NOT NULL DEFAULT 'creating',
        "containerName" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_environment_resources" PRIMARY KEY ("id")
      )
    `);

    // Create sessions table (for connect-pg-simple)
    await queryRunner.query(`
      CREATE TABLE "sessions" (
        "sid" character varying NOT NULL,
        "sess" json NOT NULL,
        "expire" TIMESTAMP(6) NOT NULL,
        CONSTRAINT "PK_sessions" PRIMARY KEY ("sid")
      )
    `);

    // Create index on sessions.expire for cleanup
    await queryRunner.query(`
      CREATE INDEX "IDX_sessions_expire" ON "sessions" ("expire")
    `);

    // Add foreign key constraints
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
      ADD CONSTRAINT "FK_audit_logs_user"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "project_resources"
      ADD CONSTRAINT "FK_project_resources_project"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "environments"
      ADD CONSTRAINT "FK_environments_project"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "environment_resources"
      ADD CONSTRAINT "FK_environment_resources_environment"
      FOREIGN KEY ("environmentId") REFERENCES "environments"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    // Create indexes for better performance
    await queryRunner.query(`
      CREATE INDEX "IDX_environments_projectId" ON "environments" ("projectId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_environment_resources_environmentId" ON "environment_resources" ("environmentId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_audit_logs_userId" ON "audit_logs" ("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_audit_logs_createdAt" ON "audit_logs" ("createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign key constraints
    await queryRunner.query(`ALTER TABLE "environment_resources" DROP CONSTRAINT "FK_environment_resources_environment"`);
    await queryRunner.query(`ALTER TABLE "environments" DROP CONSTRAINT "FK_environments_project"`);
    await queryRunner.query(`ALTER TABLE "project_resources" DROP CONSTRAINT "FK_project_resources_project"`);
    await queryRunner.query(`ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_audit_logs_user"`);

    // Drop indexes
    await queryRunner.query(`DROP INDEX "IDX_audit_logs_createdAt"`);
    await queryRunner.query(`DROP INDEX "IDX_audit_logs_userId"`);
    await queryRunner.query(`DROP INDEX "IDX_environment_resources_environmentId"`);
    await queryRunner.query(`DROP INDEX "IDX_environments_projectId"`);
    await queryRunner.query(`DROP INDEX "IDX_sessions_expire"`);

    // Drop tables
    await queryRunner.query(`DROP TABLE "sessions"`);
    await queryRunner.query(`DROP TABLE "environment_resources"`);
    await queryRunner.query(`DROP TABLE "environments"`);
    await queryRunner.query(`DROP TABLE "project_resources"`);
    await queryRunner.query(`DROP TABLE "projects"`);
    await queryRunner.query(`DROP TABLE "settings"`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
