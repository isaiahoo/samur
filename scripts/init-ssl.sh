#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# First-time SSL certificate setup with Let's Encrypt
# Usage: DOMAIN=samur.dag CERTBOT_EMAIL=admin@example.com ./scripts/init-ssl.sh
set -euo pipefail

DOMAIN="${DOMAIN:?Set DOMAIN env var (e.g. samur.dag)}"
EMAIL="${CERTBOT_EMAIL:?Set CERTBOT_EMAIL env var}"

echo "==> Generating SSL certificate for $DOMAIN"

# Create temporary nginx config without SSL for ACME challenge
mkdir -p nginx/conf.d
cat > nginx/conf.d/samur.conf.tmp <<'TMPCONF'
server {
    listen 80;
    server_name _;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 200 'Samur SSL setup in progress';
        add_header Content-Type text/plain;
    }
}
TMPCONF

# Start nginx with temp config
cp nginx/conf.d/samur.conf nginx/conf.d/samur.conf.bak 2>/dev/null || true
mv nginx/conf.d/samur.conf.tmp nginx/conf.d/samur.conf

docker compose -f docker-compose.prod.yml up -d nginx

echo "--- Requesting certificate..."
docker compose -f docker-compose.prod.yml run --rm certbot \
  certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" \
  --email "$EMAIL" \
  --agree-tos \
  --non-interactive \
  --cert-name samur

# Restore production nginx config
mv nginx/conf.d/samur.conf.bak nginx/conf.d/samur.conf 2>/dev/null || true

# Restart nginx with SSL
docker compose -f docker-compose.prod.yml restart nginx

echo "==> SSL certificate installed for $DOMAIN"
