-- Tracks whether a user ran the PWA standalone (home-screen install).
--
-- Set once by the client via POST /users/me/pwa-installed when either
-- the `appinstalled` event fires or display-mode: standalone is first
-- observed with an authenticated session. Never unset — the "В
-- сообществе" achievement should survive reinstalls + OS swaps.

ALTER TABLE "users"
  ADD COLUMN "installed_pwa_at" TIMESTAMP(3);
