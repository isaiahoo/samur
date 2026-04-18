-- Audit trail on soft-delete (audit item M3).
--
-- Adds deleted_by TEXT (nullable) to the four tables whose DELETE
-- handlers are currently firing into the void — coordinator/admin
-- soft-deletes them, but we don't capture which coordinator. Makes
-- post-incident review and moderation-pattern analysis possible
-- without joining against logs.
--
-- Additive only. Legacy soft-deleted rows have NULL deletedBy —
-- meaning "we don't know", not "nobody did it". No backfill.

ALTER TABLE "incidents"      ADD COLUMN "deleted_by" TEXT;
ALTER TABLE "help_requests"  ADD COLUMN "deleted_by" TEXT;
ALTER TABLE "alerts"         ADD COLUMN "deleted_by" TEXT;
ALTER TABLE "shelters"       ADD COLUMN "deleted_by" TEXT;
