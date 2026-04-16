-- Multi-responder model: multiple volunteers can respond to one help request,
-- each with their own progress state. The single-claimer column on
-- help_requests stays as a denormalised "primary responder" for backward
-- compatibility with existing list views.

CREATE TYPE "HelpResponseStatus" AS ENUM ('responded', 'on_way', 'arrived', 'helped', 'cancelled');

CREATE TABLE "help_responses" (
    "id" TEXT NOT NULL,
    "help_request_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "HelpResponseStatus" NOT NULL DEFAULT 'responded',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "help_responses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "help_responses_help_request_id_user_id_key"
    ON "help_responses"("help_request_id", "user_id");

CREATE INDEX "help_responses_help_request_id_status_idx"
    ON "help_responses"("help_request_id", "status");

CREATE INDEX "help_responses_user_id_idx" ON "help_responses"("user_id");

ALTER TABLE "help_responses"
    ADD CONSTRAINT "help_responses_help_request_id_fkey"
    FOREIGN KEY ("help_request_id") REFERENCES "help_requests"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "help_responses"
    ADD CONSTRAINT "help_responses_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: existing claimed requests become a single responded row so the
-- dashboard doesn't lose historical claims when the UI switches models.
INSERT INTO "help_responses" ("id", "help_request_id", "user_id", "status", "created_at", "updated_at")
SELECT
    'resp_' || substr(md5(random()::text || clock_timestamp()::text), 1, 24) as id,
    hr."id",
    hr."claimed_by",
    CASE hr."status"
        WHEN 'claimed'     THEN 'responded'::"HelpResponseStatus"
        WHEN 'in_progress' THEN 'on_way'::"HelpResponseStatus"
        WHEN 'completed'   THEN 'helped'::"HelpResponseStatus"
        WHEN 'cancelled'   THEN 'cancelled'::"HelpResponseStatus"
        ELSE 'responded'::"HelpResponseStatus"
    END,
    hr."updated_at",
    hr."updated_at"
FROM "help_requests" hr
WHERE hr."claimed_by" IS NOT NULL
  AND hr."deleted_at" IS NULL
ON CONFLICT ("help_request_id", "user_id") DO NOTHING;
