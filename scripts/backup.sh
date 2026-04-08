#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Samur database backup script
# Usage: ./scripts/backup.sh [--upload s3://bucket/path]
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"
STAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="samur_${STAMP}.dump"
UPLOAD_TARGET=""

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --upload)
      UPLOAD_TARGET="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

mkdir -p "$BACKUP_DIR"

echo "==> Creating backup: $FILENAME"

# Dump via docker exec
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-samur}" -Fc "${POSTGRES_DB:-samur}" \
  > "$BACKUP_DIR/$FILENAME"

SIZE=$(du -h "$BACKUP_DIR/$FILENAME" | cut -f1)
echo "--- Backup created: $FILENAME ($SIZE)"

# Clean old backups
echo "--- Removing backups older than $KEEP_DAYS days..."
find "$BACKUP_DIR" -name "samur_*.dump" -mtime +"$KEEP_DAYS" -delete

# Optional S3-compatible upload
if [ -n "$UPLOAD_TARGET" ]; then
  echo "--- Uploading to $UPLOAD_TARGET..."
  if command -v aws &>/dev/null; then
    aws s3 cp "$BACKUP_DIR/$FILENAME" "$UPLOAD_TARGET/$FILENAME"
  elif command -v mc &>/dev/null; then
    mc cp "$BACKUP_DIR/$FILENAME" "$UPLOAD_TARGET/$FILENAME"
  else
    echo "!!! Neither 'aws' nor 'mc' (MinIO) CLI found. Skipping upload."
  fi
fi

echo "==> Backup complete!"
ls -lh "$BACKUP_DIR"/samur_*.dump | tail -5
