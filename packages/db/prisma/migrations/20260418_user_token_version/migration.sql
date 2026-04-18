-- JWT revocation mechanism (audit item M2).
--
-- Adds a monotonically-incremented counter per user. Every JWT we
-- issue carries the current user.token_version; the auth middleware
-- rejects tokens whose payload version is below the current db value.
-- Incrementing the column invalidates every outstanding JWT for that
-- user in one write.
--
-- Additive + defaulted. Pre-existing users start at 0; pre-existing
-- JWTs (which don't carry tokenVersion yet) are interpreted as
-- version 0 by the middleware for backwards-compat, so the migration
-- doesn't invalidate any live session. Once a user's token_version
-- increments above 0 (e.g. via POST /auth/logout-all), any JWT still
-- carrying the missing/zero version fails — which is exactly what we
-- want for revocation.

ALTER TABLE "users"
  ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;
