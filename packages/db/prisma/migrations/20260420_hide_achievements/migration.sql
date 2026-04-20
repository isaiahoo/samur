-- Opt-out: hide the user's achievement wall and thank-you quotes from
-- strangers. The user always sees their own; this only affects what
-- /users/:id/stats returns when caller != user.
ALTER TABLE "users"
  ADD COLUMN "hide_achievements" BOOLEAN NOT NULL DEFAULT false;
