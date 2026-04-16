-- Append-only snapshots of ML forecasts so we can compute retrospective NSE per
-- (station, horizon). The river_levels upsert key overwrites per target date,
-- so historical horizon predictions are lost without this table.

CREATE TABLE "forecast_snapshots" (
    "id" TEXT NOT NULL,
    "river_name" TEXT NOT NULL,
    "station_name" TEXT NOT NULL,
    "forecast_made_at" DATE NOT NULL,
    "target_date" DATE NOT NULL,
    "horizon_days" INTEGER NOT NULL,
    "predicted_cm" DOUBLE PRECISION NOT NULL,
    "prediction_lower" DOUBLE PRECISION,
    "prediction_upper" DOUBLE PRECISION,
    "data_source" TEXT NOT NULL,
    "model_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecast_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "forecast_snapshots_river_name_station_name_forecast_made_at_horizon_days_key"
    ON "forecast_snapshots"("river_name", "station_name", "forecast_made_at", "horizon_days");

CREATE INDEX "forecast_snapshots_river_name_station_name_target_date_idx"
    ON "forecast_snapshots"("river_name", "station_name", "target_date");

CREATE INDEX "forecast_snapshots_target_date_idx" ON "forecast_snapshots"("target_date");
