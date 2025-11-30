-- Create environment_stats table for time-series data
CREATE TABLE "EnvironmentStats" (
    "id" SERIAL PRIMARY KEY,
    "time" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "environmentId" TEXT NOT NULL,
    "cpuPercent" DECIMAL(5,2) NOT NULL,
    "memoryUsageGB" DECIMAL(8,2) NOT NULL,
    "memoryLimitGB" DECIMAL(8,2) NOT NULL,
    "containers" JSONB NOT NULL
);

-- Create index on environmentId and time for fast lookups of latest stats
CREATE INDEX "EnvironmentStats_environmentId_time_idx" ON "EnvironmentStats" ("environmentId", "time" DESC);

-- Create index on time for cleanup queries
CREATE INDEX "EnvironmentStats_time_idx" ON "EnvironmentStats" ("time");
