-- CreateTable
CREATE TABLE "environment_actions" (
    "id" VARCHAR NOT NULL,
    "environment_id" VARCHAR NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
    "metadata" JSON,
    "started_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(6),

    CONSTRAINT "environment_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "environment_actions_environment_id_idx" ON "environment_actions"("environment_id");

-- CreateIndex
CREATE INDEX "environment_actions_status_idx" ON "environment_actions"("status");
