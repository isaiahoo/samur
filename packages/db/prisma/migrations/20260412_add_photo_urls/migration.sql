-- AlterTable
ALTER TABLE "help_requests" ADD COLUMN "photo_urls" TEXT[] DEFAULT ARRAY[]::TEXT[];
