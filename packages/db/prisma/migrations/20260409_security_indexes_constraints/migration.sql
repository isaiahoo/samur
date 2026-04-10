-- Indexes on foreign key columns
CREATE INDEX IF NOT EXISTS "incidents_user_id_idx" ON "incidents"("user_id");
CREATE INDEX IF NOT EXISTS "incidents_verified_by_idx" ON "incidents"("verified_by");
CREATE INDEX IF NOT EXISTS "help_requests_user_id_idx" ON "help_requests"("user_id");
CREATE INDEX IF NOT EXISTS "help_requests_claimed_by_idx" ON "help_requests"("claimed_by");
CREATE INDEX IF NOT EXISTS "alerts_author_id_idx" ON "alerts"("author_id");

-- Unique constraint: prevent duplicate river readings per station/time
ALTER TABLE "river_levels" ADD CONSTRAINT "river_levels_river_name_station_name_measured_at_key"
  UNIQUE ("river_name", "station_name", "measured_at");

-- Foreign key: SmsBroadcastLog → Alert
ALTER TABLE "sms_broadcast_log" ADD CONSTRAINT "sms_broadcast_log_alert_id_fkey"
  FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CHECK constraints (not supported by Prisma schema, added via raw SQL)
ALTER TABLE "river_levels" ADD CONSTRAINT "river_levels_level_cm_check"
  CHECK ("level_cm" IS NULL OR "level_cm" >= 0);

ALTER TABLE "shelters" ADD CONSTRAINT "shelters_occupancy_check"
  CHECK ("current_occupancy" >= 0 AND "current_occupancy" <= "capacity");
