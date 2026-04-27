-- Adds the two tables that have been declared as Prisma models since the
-- start but never had a migration generated for them. Both are referenced
-- by API code:
--   sms_broadcast_log : apps/api/src/routes/webhooks.ts (SMS broadcast queue + dedup)
--   channel_heartbeats: apps/api/src/routes/{webhooks,channels}.ts (multi-channel health endpoint)
-- Without these tables, calling those endpoints crashes the request with a
-- "relation does not exist" SQL error. They've been latent bugs because the
-- endpoints are operational/admin paths that are rarely hit in normal use.

CREATE TABLE "sms_broadcast_log" (
    "id"       TEXT         NOT NULL,
    "alert_id" TEXT         NOT NULL,
    "phone"    TEXT         NOT NULL,
    "sent_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_broadcast_log_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sms_broadcast_log_alert_id_phone_key"
    ON "sms_broadcast_log"("alert_id", "phone");

CREATE INDEX "sms_broadcast_log_alert_id_idx"
    ON "sms_broadcast_log"("alert_id");

ALTER TABLE "sms_broadcast_log"
    ADD CONSTRAINT "sms_broadcast_log_alert_id_fkey"
    FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE TABLE "channel_heartbeats" (
    "channel"   TEXT         NOT NULL,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata"  JSONB,

    CONSTRAINT "channel_heartbeats_pkey" PRIMARY KEY ("channel")
);
