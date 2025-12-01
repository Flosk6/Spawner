/*
  Warnings:

  - You are about to drop the column `api_resource_id` on the `project_resources` table. All the data in the column will be lost.
  - You are about to drop the column `db_resource_id` on the `project_resources` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "project_resources" DROP COLUMN "api_resource_id",
DROP COLUMN "db_resource_id";
