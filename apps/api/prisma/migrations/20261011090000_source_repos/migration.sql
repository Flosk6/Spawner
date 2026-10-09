-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "source_repos" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- The repositories the live environments of a project take sources from stay allowed.
UPDATE "projects" p SET "source_repos" = ARRAY(
  SELECT DISTINCT s."repo_url"
  FROM "environment_sources" s
  JOIN "environments" e ON e."id" = s."environment_id"
  WHERE e."project_id" = p."id" AND e."deleted_at" IS NULL AND s."repo_url" IS NOT NULL AND s."repo_url" <> p."repo_url"
  ORDER BY 1
);
