-- Contact fields on incidents so rescuers can call the reporter if
-- the report needs clarification (blocked road, damaged building,
-- etc.). Required for anonymous submits so a useless report can't
-- land on the map with no way to reach anyone; logged-in users
-- default to profile phone and can override per-report.

ALTER TABLE "incidents"
  ADD COLUMN "contact_phone" TEXT,
  ADD COLUMN "contact_name" TEXT;
