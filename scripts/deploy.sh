#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Samur deployment script
# Usage: ./scripts/deploy.sh <user@host> [branch]
#        ./scripts/deploy.sh <user@host> --rollback
set -euo pipefail

HOST="${1:-}"
ACTION="${2:-main}"
REMOTE_DIR="/opt/samur"
COMPOSE="docker compose -f docker-compose.prod.yml"

if [ -z "$HOST" ]; then
  echo "Usage: $0 <user@host> [branch]"
  echo "       $0 <user@host> --rollback"
  echo "Example: $0 deploy@samur.dag main"
  exit 1
fi

# ── Rollback ────────────────────────────────────────────────────────────
if [ "$ACTION" = "--rollback" ]; then
  echo "==> Rolling back on $HOST"
  ssh "$HOST" bash <<ROLLBACK
set -euo pipefail
cd $REMOTE_DIR

PREV=\$(cat .deploy-prev-sha 2>/dev/null || true)
if [ -z "\$PREV" ]; then
  echo "!!! No previous deployment SHA found (.deploy-prev-sha missing)"
  exit 1
fi

echo "--- Rolling back to \$PREV..."
git checkout "\$PREV"
$COMPOSE build
$COMPOSE up -d

echo "--- Waiting for API health check..."
for i in \$(seq 1 30); do
  if $COMPOSE exec -T api wget --spider -q http://localhost:3000/api/v1/health 2>/dev/null; then
    echo "--- API is healthy after rollback!"
    break
  fi
  if [ "\$i" -eq 30 ]; then
    echo "!!! API health check failed after rollback"
    $COMPOSE logs --tail=50 api
    exit 1
  fi
  sleep 2
done

echo "--- Service status:"
$COMPOSE ps
echo "==> Rollback complete (now at \$PREV)"
ROLLBACK
  exit 0
fi

# ── Normal deploy ───────────────────────────────────────────────────────
BRANCH="$ACTION"
echo "==> Deploying Samur ($BRANCH) to $HOST"

ssh "$HOST" bash <<REMOTE
set -euo pipefail
cd $REMOTE_DIR

# Save current SHA for rollback
git rev-parse HEAD > .deploy-prev-sha

echo "--- Pulling latest ($BRANCH)..."
git fetch origin
git checkout $BRANCH
git pull origin $BRANCH

# Tag this deployment
DEPLOY_TAG="deploy-\$(date +%Y%m%d-%H%M%S)"
git tag "\$DEPLOY_TAG"
echo "--- Tagged as \$DEPLOY_TAG"

echo "--- Building containers..."
$COMPOSE build

echo "--- Running database migrations..."
$COMPOSE run --rm api \
  npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma

echo "--- Restarting services..."
$COMPOSE up -d

echo "--- Waiting for API health check..."
for i in \$(seq 1 30); do
  if $COMPOSE exec -T api wget --spider -q http://localhost:3000/api/v1/health 2>/dev/null; then
    echo "--- API is healthy!"
    break
  fi
  if [ "\$i" -eq 30 ]; then
    echo "!!! API health check failed after 30 attempts"
    $COMPOSE logs --tail=50 api
    echo "!!! Run '$0 $HOST --rollback' to revert"
    exit 1
  fi
  sleep 2
done

echo "--- Service status:"
$COMPOSE ps

echo "==> Deployment complete!"
REMOTE
