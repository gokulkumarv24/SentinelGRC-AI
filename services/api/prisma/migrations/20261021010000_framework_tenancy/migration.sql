-- DropIndex
DROP INDEX "frameworks_key_version_key";

-- AlterTable
ALTER TABLE "frameworks" ADD COLUMN     "organization_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "frameworks_organization_id_key_version_key" ON "frameworks"("organization_id", "key", "version");

-- AddForeignKey
ALTER TABLE "frameworks" ADD CONSTRAINT "frameworks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Platform reference frameworks (organization_id IS NULL) are unique per key + version.
CREATE UNIQUE INDEX "frameworks_platform_key_version" ON "frameworks" ("key", "version") WHERE "organization_id" IS NULL;
