-- AlterTable
ALTER TABLE "environment_resources" ADD COLUMN IF NOT EXISTS "is_entry_point" BOOLEAN NOT NULL DEFAULT false;
