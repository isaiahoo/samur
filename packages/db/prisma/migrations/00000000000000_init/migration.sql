-- SPDX-License-Identifier: AGPL-3.0-only
-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('resident', 'volunteer', 'coordinator', 'admin');
CREATE TYPE "IncidentType" AS ENUM ('flood', 'road_blocked', 'building_damaged', 'power_out', 'water_contaminated');
CREATE TYPE "Severity" AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE "IncidentStatus" AS ENUM ('unverified', 'verified', 'resolved', 'false_report');
CREATE TYPE "HelpRequestType" AS ENUM ('need', 'offer');
CREATE TYPE "HelpCategory" AS ENUM ('rescue', 'shelter', 'food', 'water', 'medicine', 'equipment', 'transport', 'labor', 'generator', 'pump');
CREATE TYPE "Urgency" AS ENUM ('normal', 'urgent', 'critical');
CREATE TYPE "HelpRequestStatus" AS ENUM ('open', 'claimed', 'in_progress', 'completed', 'cancelled');
CREATE TYPE "AlertUrgency" AS ENUM ('info', 'warning', 'critical');
CREATE TYPE "ShelterStatus" AS ENUM ('open', 'full', 'closed');
CREATE TYPE "RiverTrend" AS ENUM ('rising', 'stable', 'falling');
CREATE TYPE "Source" AS ENUM ('pwa', 'telegram', 'vk', 'sms', 'meshtastic');
CREATE TYPE "Channel" AS ENUM ('pwa', 'telegram', 'vk', 'sms', 'meshtastic');
CREATE TYPE "Amenity" AS ENUM ('food', 'beds', 'medical', 'power', 'wifi');

-- CreateTable: users
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'resident',
    "vk_id" TEXT,
    "tg_id" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable: incidents
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "type" "IncidentType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "location" geometry(Point, 4326),
    "address" TEXT,
    "description" TEXT,
    "photo_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "IncidentStatus" NOT NULL DEFAULT 'unverified',
    "verified_by" TEXT,
    "source" "Source" NOT NULL DEFAULT 'pwa',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable: help_requests
CREATE TABLE "help_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "incident_id" TEXT,
    "type" "HelpRequestType" NOT NULL,
    "category" "HelpCategory" NOT NULL,
    "description" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "location" geometry(Point, 4326),
    "address" TEXT,
    "urgency" "Urgency" NOT NULL DEFAULT 'normal',
    "contact_phone" TEXT,
    "contact_name" TEXT,
    "status" "HelpRequestStatus" NOT NULL DEFAULT 'open',
    "claimed_by" TEXT,
    "source" "Source" NOT NULL DEFAULT 'pwa',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "help_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable: alerts
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "urgency" "AlertUrgency" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "geo_bounds" geometry(Polygon, 4326),
    "channels" "Channel"[],
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: shelters
CREATE TABLE "shelters" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "location" geometry(Point, 4326),
    "address" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "current_occupancy" INTEGER NOT NULL DEFAULT 0,
    "amenities" "Amenity"[],
    "contact_phone" TEXT,
    "status" "ShelterStatus" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "shelters_pkey" PRIMARY KEY ("id")
);

-- CreateTable: river_levels
CREATE TABLE "river_levels" (
    "id" TEXT NOT NULL,
    "river_name" TEXT NOT NULL,
    "station_name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "location" geometry(Point, 4326),
    "level_cm" DOUBLE PRECISION NOT NULL,
    "danger_level_cm" DOUBLE PRECISION NOT NULL,
    "trend" "RiverTrend" NOT NULL,
    "measured_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "river_levels_pkey" PRIMARY KEY ("id")
);

-- Unique indexes
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
CREATE UNIQUE INDEX "users_vk_id_key" ON "users"("vk_id");
CREATE UNIQUE INDEX "users_tg_id_key" ON "users"("tg_id");

-- Regular indexes
CREATE INDEX "users_role_idx" ON "users"("role");

CREATE INDEX "incidents_status_type_idx" ON "incidents"("status", "type");
CREATE INDEX "incidents_severity_idx" ON "incidents"("severity");
CREATE INDEX "incidents_created_at_idx" ON "incidents"("created_at");
CREATE INDEX "incidents_source_idx" ON "incidents"("source");

CREATE INDEX "help_requests_status_type_idx" ON "help_requests"("status", "type");
CREATE INDEX "help_requests_status_category_idx" ON "help_requests"("status", "category");
CREATE INDEX "help_requests_urgency_idx" ON "help_requests"("urgency");
CREATE INDEX "help_requests_created_at_idx" ON "help_requests"("created_at");
CREATE INDEX "help_requests_source_idx" ON "help_requests"("source");

CREATE INDEX "alerts_urgency_idx" ON "alerts"("urgency");
CREATE INDEX "alerts_sent_at_idx" ON "alerts"("sent_at");
CREATE INDEX "alerts_expires_at_idx" ON "alerts"("expires_at");

CREATE INDEX "shelters_status_idx" ON "shelters"("status");

CREATE INDEX "river_levels_river_name_measured_at_idx" ON "river_levels"("river_name", "measured_at");
CREATE INDEX "river_levels_measured_at_idx" ON "river_levels"("measured_at");

-- Spatial indexes (PostGIS GIST)
CREATE INDEX "incidents_location_gist" ON "incidents" USING GIST ("location");
CREATE INDEX "help_requests_location_gist" ON "help_requests" USING GIST ("location");
CREATE INDEX "alerts_geo_bounds_gist" ON "alerts" USING GIST ("geo_bounds");
CREATE INDEX "shelters_location_gist" ON "shelters" USING GIST ("location");
CREATE INDEX "river_levels_location_gist" ON "river_levels" USING GIST ("location");

-- Foreign keys
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "help_requests" ADD CONSTRAINT "help_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "help_requests" ADD CONSTRAINT "help_requests_claimed_by_fkey" FOREIGN KEY ("claimed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "help_requests" ADD CONSTRAINT "help_requests_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "alerts" ADD CONSTRAINT "alerts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Trigger to auto-populate location geometry from lat/lng on insert/update
CREATE OR REPLACE FUNCTION sync_location_point()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER incidents_sync_location BEFORE INSERT OR UPDATE ON "incidents"
  FOR EACH ROW EXECUTE FUNCTION sync_location_point();

CREATE TRIGGER help_requests_sync_location BEFORE INSERT OR UPDATE ON "help_requests"
  FOR EACH ROW EXECUTE FUNCTION sync_location_point();

CREATE TRIGGER shelters_sync_location BEFORE INSERT OR UPDATE ON "shelters"
  FOR EACH ROW EXECUTE FUNCTION sync_location_point();

CREATE TRIGGER river_levels_sync_location BEFORE INSERT OR UPDATE ON "river_levels"
  FOR EACH ROW EXECUTE FUNCTION sync_location_point();
