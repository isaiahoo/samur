-- CreateTable
CREATE TABLE "earthquakes" (
    "id" TEXT NOT NULL,
    "usgs_id" TEXT NOT NULL,
    "magnitude" DOUBLE PRECISION NOT NULL,
    "depth" DOUBLE PRECISION NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "place" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "felt" INTEGER,
    "mmi" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'usgs',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "earthquakes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "earthquakes_usgs_id_key" ON "earthquakes"("usgs_id");

-- CreateIndex
CREATE INDEX "earthquakes_time_idx" ON "earthquakes"("time");

-- CreateIndex
CREATE INDEX "earthquakes_magnitude_idx" ON "earthquakes"("magnitude");
