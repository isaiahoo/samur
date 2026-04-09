-- Add statistical discharge fields from Open-Meteo GloFAS
ALTER TABLE "river_levels" ADD COLUMN "discharge_median" DOUBLE PRECISION;
ALTER TABLE "river_levels" ADD COLUMN "discharge_min" DOUBLE PRECISION;
ALTER TABLE "river_levels" ADD COLUMN "discharge_p25" DOUBLE PRECISION;
ALTER TABLE "river_levels" ADD COLUMN "discharge_p75" DOUBLE PRECISION;
