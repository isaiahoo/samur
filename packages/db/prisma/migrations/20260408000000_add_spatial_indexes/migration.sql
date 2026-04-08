-- Add spatial (GIST) indexes on PostGIS geometry columns for fast ST_DWithin queries

CREATE INDEX IF NOT EXISTS "incidents_location_gist" ON "incidents" USING GIST ("location");
CREATE INDEX IF NOT EXISTS "help_requests_location_gist" ON "help_requests" USING GIST ("location");
CREATE INDEX IF NOT EXISTS "shelters_location_gist" ON "shelters" USING GIST ("location");
CREATE INDEX IF NOT EXISTS "river_levels_location_gist" ON "river_levels" USING GIST ("location");

-- Also add B-tree indexes on lat/lng for non-PostGIS bounding-box queries
CREATE INDEX IF NOT EXISTS "incidents_lat_lng" ON "incidents" ("lat", "lng");
CREATE INDEX IF NOT EXISTS "help_requests_lat_lng" ON "help_requests" ("lat", "lng");
CREATE INDEX IF NOT EXISTS "shelters_lat_lng" ON "shelters" ("lat", "lng");
CREATE INDEX IF NOT EXISTS "river_levels_lat_lng" ON "river_levels" ("lat", "lng");
