-- Supervision (milestone M4): metrics, disk snapshots, the timeline of each
-- environment, terminal sessions; project variables and public exposures.
-- The per-minute samples of EnvironmentStats are replaced by metric_points.

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "actor" VARCHAR(100);

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "allow_public" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "EnvironmentStats";

-- CreateTable
CREATE TABLE "project_variables" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "value" TEXT NOT NULL,
    "secret" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "project_variables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "environment_events" (
    "id" BIGSERIAL NOT NULL,
    "environment_id" TEXT NOT NULL,
    "time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" VARCHAR(20) NOT NULL,
    "service" VARCHAR(63),
    "message" TEXT NOT NULL,
    "details" JSONB,

    CONSTRAINT "environment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_points" (
    "id" BIGSERIAL NOT NULL,
    "time" TIMESTAMPTZ(6) NOT NULL,
    "scope" VARCHAR(10) NOT NULL,
    "environment_id" TEXT,
    "project_id" TEXT,
    "cpu_percent" DOUBLE PRECISION NOT NULL,
    "memory_bytes" BIGINT NOT NULL,
    "memory_limit_bytes" BIGINT,
    "details" JSONB,

    CONSTRAINT "metric_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_rollups" (
    "id" BIGSERIAL NOT NULL,
    "time" TIMESTAMPTZ(6) NOT NULL,
    "scope" VARCHAR(10) NOT NULL,
    "environment_id" TEXT,
    "project_id" TEXT,
    "cpu_avg" DOUBLE PRECISION NOT NULL,
    "cpu_max" DOUBLE PRECISION NOT NULL,
    "memory_avg" BIGINT NOT NULL,
    "memory_max" BIGINT NOT NULL,

    CONSTRAINT "metric_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disk_snapshots" (
    "id" BIGSERIAL NOT NULL,
    "time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_bytes" BIGINT NOT NULL,
    "free_bytes" BIGINT NOT NULL,
    "details" JSONB NOT NULL,

    CONSTRAINT "disk_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminal_sessions" (
    "id" TEXT NOT NULL,
    "environment_id" TEXT,
    "environment" VARCHAR(60) NOT NULL,
    "service" VARCHAR(63) NOT NULL,
    "user_id" INTEGER,
    "actor" VARCHAR(100) NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "end_reason" VARCHAR(20),
    "exit_code" INTEGER,
    "recorded_bytes" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "terminal_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_variables_project_id_name_key" ON "project_variables"("project_id", "name");

-- CreateIndex
CREATE INDEX "environment_events_environment_id_time_idx" ON "environment_events"("environment_id", "time");

-- CreateIndex
CREATE INDEX "environment_events_time_idx" ON "environment_events"("time");

-- CreateIndex
CREATE INDEX "metric_points_scope_time_idx" ON "metric_points"("scope", "time");

-- CreateIndex
CREATE INDEX "metric_points_environment_id_time_idx" ON "metric_points"("environment_id", "time");

-- CreateIndex
CREATE INDEX "metric_rollups_scope_time_idx" ON "metric_rollups"("scope", "time");

-- CreateIndex
CREATE INDEX "metric_rollups_environment_id_time_idx" ON "metric_rollups"("environment_id", "time");

-- CreateIndex
CREATE INDEX "disk_snapshots_time_idx" ON "disk_snapshots"("time");

-- CreateIndex
CREATE INDEX "terminal_sessions_started_at_idx" ON "terminal_sessions"("started_at");

-- CreateIndex
CREATE INDEX "environments_deleted_at_idx" ON "environments"("deleted_at");

-- AddForeignKey
ALTER TABLE "project_variables" ADD CONSTRAINT "project_variables_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environment_events" ADD CONSTRAINT "environment_events_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

