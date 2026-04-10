-- Add version column for optimistic locking on status transitions
ALTER TABLE "incidents" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "help_requests" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
