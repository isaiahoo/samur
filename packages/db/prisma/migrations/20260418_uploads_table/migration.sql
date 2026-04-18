-- Attachment ownership tracking (audit item #9).
--
-- Records a row per file saved by POST /api/v1/uploads, so the chat
-- message-send path can verify that every attached photoUrl was
-- actually uploaded by the sender. Closes a low-severity vector where
-- a participant who can observe a photo URL (e.g. via screen share or
-- cache) could pin someone else's upload to their own message.
--
-- Additive only. Legacy files on disk have no Upload row and will fail
-- the ownership check — that's intentional going forward, but doesn't
-- affect existing messages (the check runs only on new POSTs).

CREATE TABLE "uploads" (
  "filename"     TEXT         NOT NULL,
  "uploader_id"  TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "uploads_pkey" PRIMARY KEY ("filename")
);

CREATE INDEX "uploads_uploader_id_idx" ON "uploads" ("uploader_id");
CREATE INDEX "uploads_created_at_idx"  ON "uploads" ("created_at");

ALTER TABLE "uploads"
  ADD CONSTRAINT "uploads_uploader_id_fkey"
    FOREIGN KEY ("uploader_id") REFERENCES "users" ("id") ON DELETE SET NULL;
