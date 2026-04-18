-- HelpMessage.photoUrls — optional image attachments per chat message.
-- Additive column with a default empty array so existing rows are valid
-- without a backfill. The API enforces max 5 photos per message and
-- "at least one of body/photoUrls non-empty"; no DB-level CHECK because
-- the empty-array vs empty-body semantics are cleaner in app code.

ALTER TABLE "help_messages"
ADD COLUMN "photo_urls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
