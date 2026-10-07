-- v1 engine: projects, environments, sources, exposures and jobs replace the
-- resource-type model. Existing environments are not migrated: tear them down
-- before upgrading (see .ai/docs/spec-v1.md, section 15).

-- DropTable
DROP TABLE IF EXISTS "environment_actions" CASCADE;
DROP TABLE IF EXISTS "environment_resources" CASCADE;
DROP TABLE IF EXISTS "environments" CASCADE;
DROP TABLE IF EXISTS "project_resources" CASCADE;
DROP TABLE IF EXISTS "projects" CASCADE;

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(20) NOT NULL,
    "name" VARCHAR NOT NULL,
    "repo_url" VARCHAR NOT NULL,
    "default_ref" VARCHAR NOT NULL DEFAULT 'main',
    "root_dir" VARCHAR NOT NULL DEFAULT '.',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "environments" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "slug" VARCHAR(29) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "phase" VARCHAR(20),
    "error" TEXT,
    "owner_id" INTEGER,
    "created_via" VARCHAR(10) NOT NULL DEFAULT 'api',
    "manifest" JSONB,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "environments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "environment_sources" (
    "id" TEXT NOT NULL,
    "environment_id" TEXT NOT NULL,
    "name" VARCHAR(20) NOT NULL,
    "origin" VARCHAR(10) NOT NULL,
    "repo_url" VARCHAR,
    "ref" VARCHAR,
    "commit" VARCHAR(64),
    "digest" VARCHAR(64),
    "size_bytes" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "environment_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exposures" (
    "id" TEXT NOT NULL,
    "environment_id" TEXT NOT NULL,
    "name" VARCHAR(10) NOT NULL,
    "service" VARCHAR NOT NULL,
    "port" INTEGER NOT NULL,
    "host" VARCHAR NOT NULL,
    "entrypoint" BOOLEAN NOT NULL DEFAULT false,
    "auth" VARCHAR(10) NOT NULL DEFAULT 'team',

    CONSTRAINT "exposures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "environment_id" TEXT NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "phase" VARCHAR(20),
    "error" TEXT,
    "payload" JSONB,
    "triggered_by_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");

-- CreateIndex
CREATE INDEX "environments_project_id_slug_idx" ON "environments"("project_id", "slug");

-- CreateIndex
CREATE INDEX "environments_status_idx" ON "environments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "environment_sources_environment_id_name_key" ON "environment_sources"("environment_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "exposures_environment_id_name_key" ON "exposures"("environment_id", "name");

-- CreateIndex
CREATE INDEX "jobs_status_created_at_idx" ON "jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "jobs_environment_id_created_at_idx" ON "jobs"("environment_id", "created_at");

-- AddForeignKey
ALTER TABLE "environments" ADD CONSTRAINT "environments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environments" ADD CONSTRAINT "environments_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environment_sources" ADD CONSTRAINT "environment_sources_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exposures" ADD CONSTRAINT "exposures_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A slug is unique among the live environments of a project; deleted ones keep theirs.
CREATE UNIQUE INDEX "environments_project_id_slug_live_key" ON "environments"("project_id", "slug") WHERE "deleted_at" IS NULL;
