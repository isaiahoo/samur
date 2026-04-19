-- Кунак-рукопожатие: mutual confirmation of completed help.
-- Helper marks status=helped (existing flow). Requester may then:
--   - say спасибо  (confirmed_at + optional thank_you_note)
--   - mark didn't happen (rejected_at)
--   - ignore (auto-softens to "не подтверждено" after 7 days, computed at read time)
-- Silver/gold achievements gate on confirmed_at; bronze stays on self-reported.
ALTER TABLE "help_responses"
  ADD COLUMN "confirmed_at"         TIMESTAMP(3),
  ADD COLUMN "confirmed_by"         TEXT,
  ADD COLUMN "thank_you_note"       VARCHAR(280),
  ADD COLUMN "thank_you_anonymous"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rejected_at"          TIMESTAMP(3),
  ADD COLUMN "rejected_by"          TEXT;

CREATE INDEX "help_responses_user_id_confirmed_at_idx"
  ON "help_responses"("user_id", "confirmed_at");
