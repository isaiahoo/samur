# Database restore runbook

Production Postgres runs in `samur-postgres` with data on the
`samur_postgres_data` Docker volume. Nightly dumps live in
`/opt/samur/backups/` and are produced by `samur-pg-backup` at ~17:40 UTC
(20:40 Moscow). Retention: 7 days of successful dumps.

This runbook covers:
1. Inspecting what's on disk
2. **Drill**: restore into a scratch DB and verify (no production impact)
3. **Emergency**: replace the live DB from a dump

## Access

```bash
sshpass -p '<ssh password>' ssh \
  -o StrictHostKeyChecking=no -o PreferredAuthentications=password \
  root@72.56.9.176
```

> The SSH password is in the team password store; not in this file.

## First thing after SSH — set the compose overlay

Prod runs from **two** compose files. The base `docker-compose.yml` only
defines api/pwa/telegram/nginx/postgres/redis/pgadmin; `docker-compose.prod.yml`
adds `ml`, `pg-backup`, and the monitoring stack (`prometheus`, `grafana`,
exporters), and overrides api/pwa/nginx with production settings (restart
policy, memory limits, healthchecks, `uploads` volume).

Running `docker compose <cmd>` without the overlay silently targets the base
file only — it misses `ml` and `pg-backup` entirely, and recreates api
without its prod settings. Export `COMPOSE_FILE` once per session so every
subsequent `docker compose` command picks up both files:

```bash
cd /opt/samur
export COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml

# Sanity check — should list ml + pg-backup + prometheus etc.
docker compose config --services
```

All commands below assume this is set. If you open a fresh shell, re-export.

## Inventory + health check

```bash
# List backups, newest first
ls -lht /opt/samur/backups/ | head

# Any zero-byte or suspiciously-small files = bad — delete them.
# A healthy dump is currently ~400-500 KB. If the most recent file is
# much smaller than the previous one, something likely failed.

# Last 24h of the backup cron:
docker logs samur-pg-backup --since 24h
# Look for lines like "[YYYYMMDD_HHMMSS] Backup OK (NNNNNN bytes)".
# "ERROR: pg_dump failed" means that day's dump didn't happen — still OK
# as long as the previous day's file exists.
```

## Drill — practice restore without touching production

Do this every month or so. Takes ~2 minutes. Proves backups are usable.

```bash
# Pick a dump (use most recent known-good)
DUMP=/opt/samur/backups/samur_YYYYMMDD_HHMMSS.dump

# 1. Verify archive integrity
docker cp "$DUMP" samur-postgres:/tmp/restore.dump
docker exec samur-postgres pg_restore --list /tmp/restore.dump > /dev/null \
  && echo "archive is readable" || echo "CORRUPTED"

# 2. Create a scratch database and restore into it
docker exec samur-postgres psql -U samur -d postgres \
  -c 'DROP DATABASE IF EXISTS samur_restore_test;' \
  -c 'CREATE DATABASE samur_restore_test;'

docker exec samur-postgres pg_restore \
  -U samur -d samur_restore_test \
  --no-owner --no-acl /tmp/restore.dump 2>&1 | tail

# 3. Compare row counts against live
for t in users help_requests help_responses help_messages \
         incidents river_levels forecast_snapshots earthquakes \
         news_articles historical_river_levels; do
  LIVE=$(docker exec samur-postgres psql -U samur -d samur -tAc \
    "SELECT COUNT(*) FROM $t" 2>/dev/null || echo '?')
  BAK=$(docker exec samur-postgres psql -U samur -d samur_restore_test -tAc \
    "SELECT COUNT(*) FROM $t" 2>/dev/null || echo '?')
  printf '%-24s live=%-6s restored=%-6s\n' "$t" "$LIVE" "$BAK"
done

# Expected: live >= restored for every table (because activity continues
# after the backup timestamp). '?' in restored column means the table
# didn't exist yet at backup time — normal after a schema migration.

# 4. Clean up
docker exec samur-postgres psql -U samur -d postgres \
  -c 'DROP DATABASE samur_restore_test;'
docker exec samur-postgres rm -f /tmp/restore.dump
```

## Emergency restore — replacing the live DB

**Destructive.** Only do this after confirming the current DB is
unrecoverable. All data written after the dump timestamp is lost.

```bash
cd /opt/samur

# 1. Stop writers so nothing new lands during restore.
docker compose stop api telegram

# 2. Copy the dump into the postgres container.
DUMP=/opt/samur/backups/samur_YYYYMMDD_HHMMSS.dump
docker cp "$DUMP" samur-postgres:/tmp/restore.dump

# 3. Drop + recreate + restore.
docker exec samur-postgres psql -U samur -d postgres \
  -c 'DROP DATABASE samur;' \
  -c 'CREATE DATABASE samur;'
docker exec samur-postgres pg_restore \
  -U samur -d samur --no-owner --no-acl /tmp/restore.dump

# 4. Re-apply any migrations that ran AFTER the dump was taken, if any.
# (Prisma tracks applied migrations in the _prisma_migrations table,
# which is part of the dump, so normally nothing extra is needed.)
docker exec samur-api npx prisma migrate deploy \
  --schema=/app/packages/db/prisma/schema.prisma || true

# 5. Bring writers back.
docker compose start api telegram

# 6. Verify.
curl -sk https://mykunak.ru/api/v1/health
docker logs samur-api --tail 20
```

## Safer alternative — restore into a NEW database, then switch

Use this when you have time and want to verify the restored data looks
right before committing.

```bash
# Create parallel DB
docker exec samur-postgres psql -U samur -d postgres \
  -c 'CREATE DATABASE samur_recovered;'

docker cp /opt/samur/backups/<dump> samur-postgres:/tmp/r.dump
docker exec samur-postgres pg_restore -U samur -d samur_recovered \
  --no-owner --no-acl /tmp/r.dump

# Poke at it until you're satisfied, e.g.:
docker exec samur-postgres psql -U samur -d samur_recovered -c \
  "SELECT count(*) FROM help_requests WHERE deleted_at IS NULL;"

# When ready, swap by updating DATABASE_URL in /opt/samur/.env
# from /samur to /samur_recovered, then:
docker compose up -d api
# Give it a minute, verify, then drop the old DB:
# docker exec samur-postgres psql -U samur -d postgres -c 'DROP DATABASE samur;'
```

## What's NOT covered by these dumps

- **Uploaded photos** (`/opt/samur/uploads/`) — separate volume, NOT in the
  pg dump. Consider rsyncing to offsite periodically.
- **Redis state** (rate-limit counters, session tokens cache) — ephemeral by
  design; rebuilds itself within minutes of API restart.
- **Let's Encrypt certs** (`certbot-certs` volume) — backed up implicitly
  by certbot's own renewal flow; if lost, run certbot again with the same
  `--cert-name samur` and it reissues.
- **Docker volumes for monitoring** (Prometheus / Grafana data) — optional.

## If pg-backup is silently failing

Symptom: `ls -lht /opt/samur/backups/` shows no recent dump, or the most
recent file is 0 bytes.

```bash
# Live tail of the backup loop
docker logs samur-pg-backup -f

# Force a one-off backup now
docker exec samur-pg-backup sh -c \
  'pg_dump -Fc -f /backups/samur_manual_$(date +%Y%m%d_%H%M%S).dump && echo OK'

# If that errors, check Postgres is up and accepting connections
docker exec samur-postgres pg_isready -U samur
docker logs samur-postgres --tail 30
```

## Baseline row counts (snapshot, not a contract)

For sanity-checking a restored DB. Numbers grow over time; use current
production as the real reference, this is just "does it look plausible?".

| Table                    | Order of magnitude (as of 2026-04-17) |
| ------------------------ | -------------------------------------- |
| users                    | 10s                                    |
| help_requests            | 10s-100s                               |
| help_responses           | 10s-100s                               |
| help_messages            | 10s-1000s                              |
| incidents                | 10s-100s                               |
| river_levels             | 1000s-10000s (daily ingest)            |
| forecast_snapshots       | 10s-100s (daily)                       |
| earthquakes              | 10s-100s                               |
| news_articles            | 100s-1000s (daily RSS pull)            |
| historical_river_levels  | 10000s-100000s (one-time import)       |
