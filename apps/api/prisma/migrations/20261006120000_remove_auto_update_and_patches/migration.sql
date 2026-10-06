-- Auto-update and system patch management were removed (v1 cleanup).
-- "migrations" was a leftover table from the TypeORM era.

-- DropTable
DROP TABLE IF EXISTS "system_settings";

-- DropTable
DROP TABLE IF EXISTS "server_patches";

-- DropTable
DROP TABLE IF EXISTS "migrations";
