#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Samur deployment script
# Usage: ./scripts/deploy.sh [user@host] [branch]
set -euo pipefail

HOST="${1:-}"
BRANCH="${2:-main}"
REMOTE_DIR="/opt/samur"

if [ -z "$HOST" ]; then
  echo "Usage: $0 <user@host> [branch]"
  echo "Example: $0 deploy@samur.dag main"
  exit 1
fi

echo "==> Deploying Samur ($BRANCH) to $HOST"

# Pull latest code
ssh "$HOST" bash <<REMOTE
set -euo pipefail
cd $REMOTE_DIR

echo "--- Pulling latest ($BRANCH)..."
git fetch origin
git checkout $BRANCH
git pull origin $BRANCH

echo "--- Building containers..."
docker compose -f docker-compose.prod.yml build

echo "--- Running database migrations..."
docker compose -f docker-compose.prod.yml run --rm api \
  npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma

echo "--- Restarting services..."
docker compose -f docker-compose.prod.yml up -d

echo "--- Waiting for API health check..."
for i in \$(seq 1 30); do
  if docker compose -f docker-compose.prod.yml exec -T api \
    wget --spider -q http://localhost:3000/api/v1/health 2>/dev/null; then
    echo "--- API is healthy!"
    break
  fi
  if [ "\$i" -eq 30 ]; then
    echo "!!! API health check failed after 30 attempts"
    docker compose -f docker-compose.prod.yml logs --tail=50 api
    exit 1
  fi
  sleep 2
done

echo "--- Service status:"
docker compose -f docker-compose.prod.yml ps

echo "==> Deployment complete!"
REMOTE
