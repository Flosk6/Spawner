-- Why a failed job failed, for the CLI's exit codes.
ALTER TABLE "jobs" ADD COLUMN "error_code" VARCHAR(20);
