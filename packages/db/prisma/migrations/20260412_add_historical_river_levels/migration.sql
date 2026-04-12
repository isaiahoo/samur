-- CreateTable
CREATE TABLE "historical_river_levels" (
    "id" TEXT NOT NULL,
    "river_name" TEXT NOT NULL,
    "station_name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "value_cm" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'allrivers.info',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historical_river_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historical_river_stats" (
    "id" TEXT NOT NULL,
    "river_name" TEXT NOT NULL,
    "station_name" TEXT NOT NULL,
    "day_of_year" INTEGER NOT NULL,
    "avg_cm" DOUBLE PRECISION NOT NULL,
    "min_cm" DOUBLE PRECISION NOT NULL,
    "max_cm" DOUBLE PRECISION NOT NULL,
    "p10_cm" DOUBLE PRECISION NOT NULL,
    "p90_cm" DOUBLE PRECISION NOT NULL,
    "sample_count" INTEGER NOT NULL,

    CONSTRAINT "historical_river_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "historical_river_levels_river_name_station_name_date_key" ON "historical_river_levels"("river_name", "station_name", "date");

-- CreateIndex
CREATE INDEX "historical_river_levels_river_name_station_name_date_idx" ON "historical_river_levels"("river_name", "station_name", "date");

-- CreateIndex
CREATE INDEX "historical_river_levels_date_idx" ON "historical_river_levels"("date");

-- CreateIndex
CREATE UNIQUE INDEX "historical_river_stats_river_name_station_name_day_of_year_key" ON "historical_river_stats"("river_name", "station_name", "day_of_year");

-- CreateIndex
CREATE INDEX "historical_river_stats_river_name_station_name_idx" ON "historical_river_stats"("river_name", "station_name");
