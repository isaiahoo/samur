-- Tier 1 SOS Verification: add sourceIp and confidenceScore to help_requests
ALTER TABLE "help_requests" ADD COLUMN "source_ip" TEXT;
ALTER TABLE "help_requests" ADD COLUMN "confidence_score" INTEGER;

-- Index for anonymous dedup queries (IP + SOS + status)
CREATE INDEX "help_requests_source_ip_is_sos_status_idx"
  ON "help_requests" ("source_ip", "is_sos", "status")
  WHERE "source_ip" IS NOT NULL AND "is_sos" = true;
