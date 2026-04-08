-- AlterTable: make levelCm and dangerLevelCm nullable, add discharge fields
ALTER TABLE "river_levels" ALTER COLUMN "level_cm" DROP NOT NULL;
ALTER TABLE "river_levels" ALTER COLUMN "danger_level_cm" DROP NOT NULL;

ALTER TABLE "river_levels" ADD COLUMN "discharge_cubic_m" DOUBLE PRECISION;
ALTER TABLE "river_levels" ADD COLUMN "discharge_mean" DOUBLE PRECISION;
ALTER TABLE "river_levels" ADD COLUMN "discharge_max" DOUBLE PRECISION;
ALTER TABLE "river_levels" ADD COLUMN "data_source" TEXT;
ALTER TABLE "river_levels" ADD COLUMN "is_forecast" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "river_levels_river_name_station_name_is_forecast_measured_a_idx"
  ON "river_levels"("river_name", "station_name", "is_forecast", "measured_at");
