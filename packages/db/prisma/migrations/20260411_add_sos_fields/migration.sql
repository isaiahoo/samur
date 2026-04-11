-- AlterTable
ALTER TABLE "help_requests" ADD COLUMN "is_sos" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "help_requests" ADD COLUMN "situation" TEXT;
ALTER TABLE "help_requests" ADD COLUMN "people_count" INTEGER;
ALTER TABLE "help_requests" ADD COLUMN "battery_level" INTEGER;

-- CreateIndex
CREATE INDEX "help_requests_is_sos_status_idx" ON "help_requests"("is_sos", "status");
