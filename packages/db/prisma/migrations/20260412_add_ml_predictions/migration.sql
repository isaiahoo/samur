-- Add prediction confidence bands to river_levels
ALTER TABLE "river_levels" ADD COLUMN "prediction_lower" DOUBLE PRECISION;
ALTER TABLE "river_levels" ADD COLUMN "prediction_upper" DOUBLE PRECISION;

-- ML model metrics tracking
CREATE TABLE "ml_model_metrics" (
    "id" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "station_key" TEXT NOT NULL,
    "horizon" INTEGER NOT NULL DEFAULT 1,
    "nse" DOUBLE PRECISION NOT NULL,
    "kge" DOUBLE PRECISION NOT NULL,
    "rmse" DOUBLE PRECISION NOT NULL,
    "evaluated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ml_model_metrics_pkey" PRIMARY KEY ("id")
);

-- Index
CREATE INDEX "ml_model_metrics_model_name_station_key_idx" ON "ml_model_metrics"("model_name", "station_key");
