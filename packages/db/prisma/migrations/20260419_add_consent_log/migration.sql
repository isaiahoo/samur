-- 152-ФЗ consent ledger.
--
-- Append-only: app code only ever inserts. The "current state" for a
-- user is the latest row per (user_id, consent_type), retrieved via
-- DISTINCT ON. Withdrawals (if ever exposed) become accepted=false rows
-- on top of the prior accepted=true row.
--
-- consent_version is a content hash of legal/privacy-policy.md at the
-- moment of the grant — lets us prove which text the user actually
-- saw even after the policy is edited.

CREATE TYPE "ConsentType" AS ENUM ('processing', 'distribution');

CREATE TABLE "consent_log" (
  "id"              TEXT NOT NULL,
  "user_id"         TEXT NOT NULL,
  "consent_type"    "ConsentType" NOT NULL,
  "consent_version" TEXT NOT NULL,
  "accepted"        BOOLEAN NOT NULL,
  "accepted_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip_address"      VARCHAR(45),
  "user_agent"      VARCHAR(500),

  CONSTRAINT "consent_log_pkey" PRIMARY KEY ("id")
);

-- Latest-per-user lookup is the dominant query (auth gate, public-map
-- filter). The desc sort on accepted_at makes DISTINCT ON cheap.
CREATE INDEX "consent_log_user_id_consent_type_accepted_at_idx"
  ON "consent_log" ("user_id", "consent_type", "accepted_at" DESC);

ALTER TABLE "consent_log"
  ADD CONSTRAINT "consent_log_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
