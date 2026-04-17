# Monitoring runbook

Two layers of monitoring cover Kunak:

1. **Internal metrics** — Prometheus + Grafana stack running as
   `samur-prometheus` / `samur-grafana` on the production host. Collects
   `/metrics` from the API, postgres-exporter, redis-exporter, node-exporter.
   Useful for "why is the API slow" and "is memory climbing", but **cannot
   tell you the site is down** — if the server itself dies, so does Prometheus.

2. **External uptime probe** — a watcher outside the server hits public
   endpoints every few minutes and alerts when they stop responding. This
   is what catches "whole site is offline" and "SSL cert expired".

This runbook sets up (2). It's the single highest-value monitoring you can
add because you learn about outages within 5 minutes, from anywhere, for free.

## Recommended: UptimeRobot (free tier)

- 50 monitors, 5-minute check interval, email + SMS + Telegram + Slack alerts
- No server-side install — runs entirely on UptimeRobot's infrastructure
- Probes from multiple global regions by default

### Setup

1. **Create an account** at <https://uptimerobot.com>.
2. Dashboard → **+ New Monitor**.

### Three monitors to create

| Monitor name | Type | URL | Interval | Keyword (optional) |
|---|---|---|---|---|
| **Kunak API health** | HTTP(s) keyword | `https://mykunak.ru/api/v1/health` | 5 min | `"status":"healthy"` |
| **Kunak home page** | HTTP(s) | `https://mykunak.ru/` | 5 min | — |
| **Kunak SSL** | SSL | `https://mykunak.ru` | 1 day | — |

Why three:

- **API health** uses the keyword match. A successful response with
  `"status":"degraded"` (DB unreachable) won't contain `"healthy"` and
  will trigger an alert even though the HTTP status is 200. This is
  the one that tells you the stack is fully working.
- **Home page** catches cases where the API is up but nginx/pwa is
  broken — unlikely but covers the blind spot.
- **SSL** warns ~30 days before cert expiry. Certbot auto-renews but
  if the renewal fails silently, this catches it.

### Telegram alerting

UptimeRobot has a native Telegram integration:

1. Settings → Alert Contacts → **+ Add Alert Contact**
2. Type: **Telegram**
3. Follow the bot link they provide — it walks you through authorising
   `@UptimeRobotBot` to message you
4. Attach the contact to each of the three monitors above

Now any outage pings your phone within 5 minutes of detection.

### What to do when an alert fires

```bash
# 1. Is the server reachable at all?
ssh root@72.56.9.176
# If this hangs, the host itself is down — contact hosting provider.

# 2. Are containers running?
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep samur

# 3. If API is unhealthy:
docker logs samur-api --tail 50
docker exec samur-api node -e 'console.log("ok")' || echo "api container broken"

# 4. If DB is the problem:
docker exec samur-postgres pg_isready -U samur
docker logs samur-postgres --tail 30

# 5. If nginx is broken (rare):
docker exec samur-nginx nginx -t
docker logs samur-nginx --tail 30

# 6. Common recovery (always export COMPOSE_FILE first on prod — base
# compose omits ml/pg-backup and drops prod-only api settings):
cd /opt/samur
export COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
docker compose restart api
# or: docker compose up -d --force-recreate api
```

## Alternative: Uptime Kuma (self-hosted)

If you prefer not to depend on an external SaaS, run Uptime Kuma in a
Docker container. Works, but with one important caveat: **if the server
dies, Uptime Kuma dies with it**, and you learn about the outage from
users complaining. Only useful alongside an external probe, not instead.

Skipped here — UptimeRobot's free tier covers the need.

## Related internal metrics

Already running, accessible on the VPS via SSH port-forwards (don't
expose publicly):

```bash
# Prometheus UI
ssh -L 9090:localhost:9090 root@72.56.9.176
# then open http://localhost:9090

# Grafana dashboards
ssh -L 3001:localhost:3000 root@72.56.9.176  # or whatever port it's bound to
```

Useful Prometheus queries:
- `rate(http_requests_total[5m])` — API RPS
- `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))` — p95 latency
- `pg_up` — Postgres reachability (1 = up)
- `redis_up` — Redis reachability

## Alert fatigue — keep it minimal

Resist the urge to monitor everything. Three external checks + existing
Prometheus is enough. More checks = more false alarms = alerts you learn
to ignore = you miss the real one when it matters.
