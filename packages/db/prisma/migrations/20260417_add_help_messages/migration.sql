-- In-app group chat per help request. Participants are the author, any
-- non-cancelled responder, and coordinators/admins. Offline SMS digest is
-- deferred — the table structure is agnostic to transport so a later job
-- can read new rows and push them out.

CREATE TABLE "help_messages" (
    "id" TEXT NOT NULL,
    "help_request_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "help_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "help_messages_help_request_id_created_at_idx"
    ON "help_messages"("help_request_id", "created_at");

CREATE INDEX "help_messages_author_id_idx" ON "help_messages"("author_id");
CREATE INDEX "help_messages_deleted_at_idx" ON "help_messages"("deleted_at");

ALTER TABLE "help_messages"
    ADD CONSTRAINT "help_messages_help_request_id_fkey"
    FOREIGN KEY ("help_request_id") REFERENCES "help_requests"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "help_messages"
    ADD CONSTRAINT "help_messages_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Per-user "last read" watermark so we can compute unread counts cheaply
-- (COUNT(*) WHERE help_request_id = X AND created_at > last_read_at).
CREATE TABLE "help_message_reads" (
    "id" TEXT NOT NULL,
    "help_request_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "last_read_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "help_message_reads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "help_message_reads_help_request_id_user_id_key"
    ON "help_message_reads"("help_request_id", "user_id");

CREATE INDEX "help_message_reads_user_id_idx" ON "help_message_reads"("user_id");

ALTER TABLE "help_message_reads"
    ADD CONSTRAINT "help_message_reads_help_request_id_fkey"
    FOREIGN KEY ("help_request_id") REFERENCES "help_requests"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "help_message_reads"
    ADD CONSTRAINT "help_message_reads_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
