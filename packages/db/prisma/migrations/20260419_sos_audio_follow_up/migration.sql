-- SOS follow-up audio attachment.
--
-- Authors (authenticated or anonymous-with-update-token) can attach a
-- voice memo after firing the SOS. Storing the URL only — the actual
-- blob lives in the same object-storage bucket as photos.

ALTER TABLE "help_requests"
  ADD COLUMN "audio_url" TEXT;
