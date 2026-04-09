-- Add station annual mean discharge for meaningful tier calculation
-- (GloFAS daily mean tracks seasonal patterns too closely, always ratio ~1.0)
ALTER TABLE "river_levels" ADD COLUMN "discharge_annual_mean" DOUBLE PRECISION;
