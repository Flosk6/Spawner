-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "githubId" VARCHAR NOT NULL,
    "username" VARCHAR NOT NULL,
    "email" VARCHAR,
    "avatarUrl" VARCHAR,
    "role" VARCHAR NOT NULL DEFAULT 'user',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "action" VARCHAR NOT NULL,
    "details" TEXT,
    "ipAddress" VARCHAR,
    "userAgent" VARCHAR,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR NOT NULL,
    "base_domain" VARCHAR NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_resources" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "name" VARCHAR NOT NULL,
    "type" VARCHAR NOT NULL,
    "git_repo" VARCHAR,
    "default_branch" VARCHAR,
    "db_resource_id" INTEGER,
    "api_resource_id" INTEGER,
    "static_env_vars" JSON NOT NULL DEFAULT '{}',
    "post_build_commands" JSON NOT NULL DEFAULT '[]',
    "resource_limits" JSON,
    "exposed_port" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "environments" (
    "id" VARCHAR NOT NULL,
    "name" VARCHAR NOT NULL,
    "project_id" INTEGER,
    "status" VARCHAR NOT NULL,
    "config_json" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "environments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "environment_resources" (
    "id" VARCHAR NOT NULL,
    "environment_id" VARCHAR NOT NULL,
    "resource_name" VARCHAR NOT NULL,
    "resource_type" VARCHAR NOT NULL,
    "branch" VARCHAR,
    "url" VARCHAR,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "environment_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR NOT NULL,
    "value" VARCHAR NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR NOT NULL,
    "value" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_patches" (
    "id" SERIAL NOT NULL,
    "packageName" VARCHAR NOT NULL,
    "currentVersion" VARCHAR NOT NULL,
    "latestVersion" VARCHAR NOT NULL,
    "type" VARCHAR NOT NULL DEFAULT 'feature',
    "status" VARCHAR NOT NULL DEFAULT 'pending',
    "changelog" TEXT,
    "appliedAt" TIMESTAMP(6),
    "detectedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_patches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "sid" VARCHAR NOT NULL,
    "sess" JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("sid")
);

-- CreateTable
CREATE TABLE "migrations" (
    "id" SERIAL NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "name" VARCHAR NOT NULL,

    CONSTRAINT "migrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_githubId_key" ON "users"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_name_key" ON "projects"("name");

-- CreateIndex
CREATE UNIQUE INDEX "environments_name_key" ON "environments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- CreateIndex
CREATE INDEX "sessions_expire_idx" ON "sessions"("expire");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_resources" ADD CONSTRAINT "project_resources_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environments" ADD CONSTRAINT "environments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environment_resources" ADD CONSTRAINT "environment_resources_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
