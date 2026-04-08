# Samur Platform — Full Audit Report

**Date:** 2026-04-08
**Scope:** API, PWA, Telegram, VK, Meshtastic, SMS, Infrastructure, Security

---

## Summary

| Category | Status |
|----------|--------|
| API (Express + Prisma) | 14 routes, 48+ endpoints — fully implemented |
| PWA (React + MapLibre) | 6 pages + admin dashboard, offline support, real-time |
| Telegram Bot | 7 commands, offline queue — production-ready |
| VK Mini App | All panels working, not containerized |
| Meshtastic Bridge | Python service, hardware-dependent, not containerized |
| SMS Gateway | API endpoints ready, needs external provider |
| Database | PostGIS 16, automated backups, single migration |
| Infrastructure | Redis, nginx (SSL-ready), Prometheus/Grafana |
| CI/CD | Manual deploy.sh only — no automation |
| Testing | 6 API test files, zero frontend/bot tests |

---

## Critical Issues

### 1. Exposed Secrets in Git History
- **File:** `.env` committed to repository
- **Exposed:** TG_BOT_TOKEN, VK_SECRET, VK_SERVICE_KEY, WEBHOOK_API_KEY, MAPTILER_API_KEY, JWT_SECRET
- **Fix:** Rotate all credentials, add `.env` to `.gitignore`, scrub git history with `git-filter-repo`
- **Status:** [ ] Not fixed

### 2. Webhook API Key Bypass
- **File:** `apps/api/src/middleware/apiKey.ts:13-15`
- **Issue:** If `WEBHOOK_API_KEY` is not set, middleware calls `next()` — all SMS/Meshtastic webhooks unprotected
- **Fix:** Return 500 error if API key not configured instead of silently allowing requests
- **Status:** [x] Fixed

### 3. Missing Authorization on PATCH Endpoints
- **Files:** `apps/api/src/routes/incidents.ts`, `apps/api/src/routes/helpRequests.ts`
- **Issue:** Any authenticated user can PATCH any incident or help request — no ownership check
- **Fix:** Add ownership verification: only the author or coordinator/admin can modify
- **Status:** [x] Fixed

---

## High Priority Issues

### 4. No PostGIS Spatial Indexes
- **File:** `packages/db/prisma/migrations/00000000000000_init/migration.sql`
- **Issue:** Geometry columns (`location`) have no GIST indexes — `ST_DWithin` queries will degrade as data grows
- **Fix:** Add migration with `CREATE INDEX ... USING GIST (location)` on incidents, help_requests, shelters, river_levels
- **Status:** [x] Fixed

### 5. No React Error Boundary
- **File:** `apps/pwa/src/App.tsx`
- **Issue:** Any unhandled component error crashes the entire application with a white screen
- **Fix:** Add ErrorBoundary component wrapping the app
- **Status:** [x] Fixed

### 6. No CI/CD Pipeline
- **Issue:** Only manual `scripts/deploy.sh` — no automated linting, type checking, or testing on PR
- **Fix:** Add GitHub Actions workflow for lint + typecheck + test
- **Status:** [x] Fixed

### 7. Minimal Test Coverage
- **Location:** `apps/api/tests/` — 6 files covering happy paths only
- **Missing:** Authorization edge cases, error paths, role-based access, frontend tests, bot tests
- **Fix:** Expand API tests, add Vitest for PWA components
- **Status:** [ ] Not fixed (future work)

### 8. No Error Monitoring
- **Issue:** No Sentry or crash reporting — production errors are silent
- **Fix:** Integrate Sentry SDK in API and PWA
- **Status:** [ ] Not fixed (requires Sentry account/DSN)

---

## Medium Priority Issues

### 9. Type Safety Gaps in PWA
- **Files:** `apps/pwa/src/services/api.ts`, various components
- **Issue:** Heavy use of `Record<string, unknown>` and `unknown` casts
- **Fix:** Create proper response types in `@samur/shared`, use them in API service
- **Status:** [ ] Not fixed

### 10. No Background Sync API
- **File:** `apps/pwa/src/services/outbox.ts`
- **Issue:** Uses 30-second polling instead of Background Sync API — drains battery on mobile
- **Fix:** Implement `registration.sync.register()` with polling fallback
- **Status:** [ ] Not fixed

### 11. No Request Deduplication
- **Issue:** Concurrent identical API calls (e.g., double-tap submit) are not deduplicated
- **Fix:** Add pending request tracking or disable buttons during submission
- **Status:** [ ] Not fixed

### 12. Grafana Default Password
- **File:** `docker-compose.prod.yml:202`
- **Issue:** Falls back to `samur` if `GRAFANA_PASSWORD` env var not set
- **Fix:** Remove default, make required
- **Status:** [x] Fixed

### 13. Deprecated X-Frame-Options
- **File:** `nginx/conf.d/samur.conf.https-ready:35`
- **Issue:** `ALLOW-FROM https://vk.com` is deprecated — CSP `frame-ancestors` already configured
- **Fix:** Remove deprecated header
- **Status:** [x] Fixed

### 14. Socket Error Handling
- **File:** `apps/pwa/src/services/socket.ts`
- **Issue:** Socket.io errors not explicitly handled — no `socket.on('error')` or `connect_error`
- **Fix:** Add error event listeners with user-facing feedback
- **Status:** [ ] Not fixed

### 15. Unused Export
- **File:** `apps/pwa/src/components/map/MarkerIcons.ts`
- **Issue:** `getRiverColor()` exported but never called — colors hardcoded inline in MapView
- **Fix:** Remove unused function
- **Status:** [x] Fixed

---

## Low Priority / Polish

### 16. Missing ARIA Labels
- **Issue:** Tab navigation icons lack proper `aria-label` attributes
- **Status:** [ ] Not fixed

### 17. No Request ID Tracing
- **Issue:** No correlation ID across API requests for debugging
- **Status:** [ ] Not fixed

### 18. VK Mini App Not Containerized
- **Issue:** SPA requires separate CDN or nginx deployment — not in docker-compose
- **Status:** [ ] Not fixed

### 19. Meshtastic Bridge Documentation
- **Issue:** No installation guide for Raspberry Pi hardware setup
- **Status:** [ ] Not fixed

---

## Production Deployment Checklist

- [ ] All secrets rotated and stored securely (not in git)
- [ ] `.env` removed from git history
- [x] HTTPS nginx config ready (`samur.conf.https-ready`)
- [x] Database backups automated (pg-backup service)
- [x] Rate limiting configured (anonymous/auth/coordinator tiers)
- [x] Health checks on all services
- [ ] Monitoring dashboards created in Grafana
- [ ] Load testing completed
- [ ] Domain `samurchs.ru` configured (DNS, SSL, CORS)
- [x] PostGIS spatial indexes added
- [x] CI/CD pipeline configured
- [ ] Error monitoring (Sentry) integrated
