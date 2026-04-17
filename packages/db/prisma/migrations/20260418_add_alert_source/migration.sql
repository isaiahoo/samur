-- Alert.source — classifies how the alert was produced so the UI can
-- show a distinct icon + label per pipeline and, later, filter by origin.

CREATE TYPE "AlertSource" AS ENUM ('manual', 'river', 'seismic', 'ai_forecast', 'news');

ALTER TABLE "alerts"
ADD COLUMN "source" "AlertSource" NOT NULL DEFAULT 'manual';

-- Backfill existing rows with a best-effort heuristic on title content.
-- Ordered most-specific first so AI alerts (which also contain "Станция")
-- aren't mis-classified as river alerts.
UPDATE "alerts"
SET "source" = 'ai_forecast'
WHERE "title" ILIKE '%Кунак AI%' OR "title" LIKE '🌊%';

UPDATE "alerts"
SET "source" = 'seismic'
WHERE "title" ILIKE '%Землетрясение%' OR "title" LIKE '🔴%';

UPDATE "alerts"
SET "source" = 'river'
WHERE "source" = 'manual'
  AND ("title" ILIKE '%уровень воды%' OR "title" ILIKE '%опасн% отметк%');

CREATE INDEX "alerts_source_idx" ON "alerts"("source");
