-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "allow_always_on" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "environment_sources" ADD COLUMN     "on_disk" BOOLEAN NOT NULL DEFAULT true;
