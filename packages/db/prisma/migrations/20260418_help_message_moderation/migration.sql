-- Moderation MVP for the help-request chat (audit item #6).
--
-- Adds:
--   1. Two audit columns on help_messages for tracking soft-deletions
--   2. A user-report table with a queue-friendly composite index
--   3. Two enums for report reason and report status
--
-- Additive only — no existing rows touched. help_messages.deleted_at
-- already exists; we augment it with the "who deleted this and why".

-- ── Audit columns on help_messages ──────────────────────────────────
ALTER TABLE "help_messages"
  ADD COLUMN "deleted_by"     TEXT,
  ADD COLUMN "deleted_reason" TEXT;

-- ── Enums ───────────────────────────────────────────────────────────
CREATE TYPE "HelpMessageReportReason" AS ENUM (
  'abuse',
  'spam',
  'doxxing',
  'off_topic',
  'other'
);

CREATE TYPE "HelpMessageReportStatus" AS ENUM (
  'open',
  'resolved_delete',
  'resolved_dismiss'
);

-- ── Report table ────────────────────────────────────────────────────
CREATE TABLE "help_message_reports" (
  "id"          TEXT                       NOT NULL,
  "message_id"  TEXT                       NOT NULL,
  "reporter_id" TEXT                       NOT NULL,
  "reason"      "HelpMessageReportReason"  NOT NULL,
  "details"     VARCHAR(500),
  "status"      "HelpMessageReportStatus"  NOT NULL DEFAULT 'open',
  "resolved_by" TEXT,
  "resolved_at" TIMESTAMP(3),
  "created_at"  TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "help_message_reports_pkey" PRIMARY KEY ("id")
);

-- One active report per (message, reporter). Duplicate submissions from
-- the same user upsert at the API layer rather than create a new row.
CREATE UNIQUE INDEX "help_message_reports_message_reporter_key"
  ON "help_message_reports" ("message_id", "reporter_id");

-- Drives the coordinator's "open reports, oldest first" queue.
CREATE INDEX "help_message_reports_status_created_idx"
  ON "help_message_reports" ("status", "created_at");

-- For "what have I reported" lookups from the client.
CREATE INDEX "help_message_reports_reporter_idx"
  ON "help_message_reports" ("reporter_id");

-- ── Foreign keys ────────────────────────────────────────────────────
ALTER TABLE "help_message_reports"
  ADD CONSTRAINT "help_message_reports_message_id_fkey"
    FOREIGN KEY ("message_id")  REFERENCES "help_messages" ("id") ON DELETE CASCADE,
  ADD CONSTRAINT "help_message_reports_reporter_id_fkey"
    FOREIGN KEY ("reporter_id") REFERENCES "users"         ("id") ON DELETE CASCADE,
  ADD CONSTRAINT "help_message_reports_resolved_by_fkey"
    FOREIGN KEY ("resolved_by") REFERENCES "users"         ("id") ON DELETE SET NULL;
