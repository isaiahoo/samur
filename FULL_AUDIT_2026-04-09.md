# Samur — Full File-by-File Audit

**Date:** 2026-04-09
**Auditor:** Claude Opus 4.6
**Scope:** Every file in the monorepo — API, PWA, Telegram, VK, shared packages, DB, scripts, infra

---

## Table of Contents

1. [Critical Fixes (Security & Data Integrity)](#1-critical-fixes)
2. [High Priority (Reliability & Correctness)](#2-high-priority)
3. [Medium Priority (Robustness & UX)](#3-medium-priority)
   - [API Middleware & Lib](#api-middleware--lib)
   - [API Routes](#api-routes)
   - [API Services](#api-services)
   - [PWA Frontend](#pwa-frontend)
   - [Telegram Bot](#telegram-bot)
   - [VK Mini App](#vk-mini-app)
   - [Infrastructure](#infrastructure)
4. [Low Priority (Quality of Life)](#4-low-priority)
   - [Test Coverage](#test-coverage)
   - [Code Organization](#code-organization)
   - [Accessibility & i18n](#accessibility--i18n)
   - [Features Not Yet Implemented](#features-not-yet-implemented)
5. [Recommended Execution Order](#5-recommended-execution-order)

---

## 1. Critical Fixes

### 1.1 Database Schema — Missing Indexes & Constraints

**File:** `packages/db/prisma/schema.prisma`

5 foreign key columns lack indexes, causing slow joins on every list query:

| Missing Index | Impact |
|---|---|
| `Incident.userId` | Author lookups O(n) |
| `Incident.verifiedBy` | Verification queue slow |
| `HelpRequest.userId` | User's requests lookup slow |
| `HelpRequest.claimedBy` | Volunteer dashboard slow |
| `Alert.authorId` | Alert audit slow |

**Missing unique constraint:** `RiverLevel(riverName, stationName, measuredAt)` — allows duplicate readings per station/time, corrupting analytics.

**Missing FK:** `SmsBroadcastLog.alertId` has no foreign key — orphaned SMS logs possible.

**Missing CHECK constraints:**
- `RiverLevel.levelCm >= 0`
- `Shelter.currentOccupancy <= capacity AND currentOccupancy >= 0`

**Migration SQL to fix:**
```sql
-- Indexes
CREATE INDEX incidents_user_id_idx ON incidents(user_id);
CREATE INDEX incidents_verified_by_idx ON incidents(verified_by);
CREATE INDEX help_requests_user_id_idx ON help_requests(user_id);
CREATE INDEX help_requests_claimed_by_idx ON help_requests(claimed_by);
CREATE INDEX alerts_author_id_idx ON alerts(author_id);

-- Unique constraint
ALTER TABLE river_levels ADD CONSTRAINT river_levels_unique_reading
  UNIQUE (river_name, station_name, measured_at);

-- FK
ALTER TABLE sms_broadcast_log ADD CONSTRAINT sms_broadcast_log_alert_id_fkey
  FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE;

-- CHECK constraints
ALTER TABLE river_levels ADD CONSTRAINT river_levels_level_cm_check
  CHECK (level_cm IS NULL OR level_cm >= 0);
ALTER TABLE shelters ADD CONSTRAINT shelters_occupancy_check
  CHECK (current_occupancy >= 0 AND current_occupancy <= capacity);
```

---

### 1.2 Socket.IO — No Authentication

**File:** `apps/api/src/socket.ts` line 37

Any client can connect and subscribe to all real-time events without a token. This leaks incident locations, help requests, and alert data to unauthenticated users.

**Fix:** Add auth middleware:
```ts
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  try { jwt.verify(token, config.JWT_SECRET); next(); }
  catch { next(new Error("Unauthorized")); }
});
```

---

### 1.3 API Key Timing Attack

**File:** `apps/api/src/middleware/apiKey.ts` line 25

String comparison `key !== config.WEBHOOK_API_KEY` is not constant-time. Attackers can brute-force the key byte-by-byte.

**Fix:** Use `crypto.timingSafeEqual(Buffer.from(key), Buffer.from(config.WEBHOOK_API_KEY))`.

---

### 1.4 SQL Injection via Table Name

**File:** `apps/api/src/lib/spatial.ts` line 17

`table` parameter interpolated into raw SQL. Although currently called with hardcoded values, the function signature accepts any string.

**Fix:** Whitelist table names:
```ts
const ALLOWED = ["incidents", "help_requests"] as const;
if (!ALLOWED.includes(table)) throw new Error("Invalid table");
```

---

### 1.5 Auth — Role on Registration

**File:** `apps/api/src/routes/auth.ts` line 56

Client can specify their own role on signup. A user could register as `admin`.

**Fix:** Always force `role: "resident"` regardless of request body.

---

### 1.6 Nginx CSP — `unsafe-inline`

**File:** `nginx/conf.d/samur.conf.https-ready`

CSP allows `'unsafe-inline'` for scripts and styles, defeating XSS protection entirely.

**Fix:** Use nonce-based CSP or remove inline scripts/styles.

---

### 1.7 VK Auth Dev Bypass

**File:** `apps/api/src/routes/authVk.ts` lines 80-86

If `VK_SECRET` is empty and `NODE_ENV === "development"`, signature verification is skipped. If production misconfigures this, anyone can forge VK auth.

**Fix:**
```ts
if (!config.VK_SECRET && config.NODE_ENV === "production") {
  throw new Error("VK_SECRET required in production");
}
```

---

### 1.8 XSS in VK Map Popups

**File:** `apps/vk/src/panels/MapPanel.tsx` lines 186, 197, 209

Popup HTML built via string concatenation with user-supplied content. Direct XSS vector.

**Fix:** HTML-escape all user-provided content before inserting into popup HTML, or use React portals.

---

## 2. High Priority

### 2.1 Race Conditions on Status Transitions

**Files:** `apps/api/src/routes/incidents.ts` line 157, `apps/api/src/routes/helpRequests.ts` line 173

Fetch-then-update pattern with no locking. Two concurrent requests can both pass validation and write conflicting statuses.

**Fix:** Use optimistic locking with a `version` field:
```ts
await prisma.helpRequest.update({
  where: { id, version: oldVersion },
  data: { status: newStatus, version: { increment: 1 } },
});
```
Or wrap in `prisma.$transaction()` with `SELECT ... FOR UPDATE`.

---

### 2.2 Scheduler Not Cluster-Safe

**File:** `apps/api/src/services/scheduler.ts` lines 36-39

Guard flags (`isRunning`) are per-process booleans. If multiple API instances run (common in Docker with replicas), all instances run every cron job simultaneously.

**Fix:** Use Redis distributed lock (`SET key NX EX ttl`) before each job.

---

### 2.3 Scheduler Intervals Never Cleared on Crash

**File:** `apps/api/src/services/scheduler.ts` lines 171-195

`setInterval` handles are stored but `stopScheduler()` is only called from graceful shutdown. If the process crashes, intervals leak. Additionally, no timeout wraps long-running tasks — a hung scraper blocks the interval forever.

**Fix:**
- Add `Promise.race()` with timeout per task (e.g., 5 minutes).
- Register `process.on('exit', stopScheduler)`.

---

### 2.4 Earthquake Alert Dedup Map — Unbounded Growth

**File:** `apps/api/src/services/earthquakeClient.ts` lines 115-122

`alertedUsgsIds` Map grows indefinitely; pruning only happens inside `fetchEarthquakes()`. If that function stops being called, the map leaks memory forever.

**Fix:** Use a separate cleanup interval or an LRU cache with size limit.

---

### 2.5 Lost Alerts on DB Failure

**File:** `apps/api/src/services/earthquakeClient.ts` lines 306-343

If alert creation fails, the earthquake is already marked in `alertedUsgsIds`, so it's never retried. A 5+ minute window of lost alerts.

**Fix:** Only add to `alertedUsgsIds` after successful DB write. Add retry with backoff.

---

### 2.6 River Scraper — Regex HTML Parsing

**File:** `apps/api/src/services/riverScraper.ts` lines 85-140

Regex like `/составляет\s*<b>\s*(\d+)/` breaks if the source site changes HTML structure at all (e.g., `<b>` to `<strong>`).

**Fix:** Use `cheerio` (HTML parser) instead of regex. Add snapshot-based tests for known HTML structures.

---

### 2.7 River Scraper — 80+ DB Queries Per Cycle

**File:** `apps/api/src/services/riverScraper.ts` lines 482-549

Each of 20 stations triggers 4+ DB round-trips (findFirst, create, deleteMany, create x forecasts) = 80+ queries per hourly cycle.

**Fix:** Collect all writes, use `prisma.riverLevel.createMany()`.

---

### 2.8 News Fetcher — Unique Constraint Check by Message String

**File:** `apps/api/src/services/newsFetcher.ts` lines 171-176

Catches duplicates via `err.message.includes("Unique constraint")`. This string varies by database version and locale.

**Fix:** Check Prisma error code: `if (err.code === 'P2002')`.

---

### 2.9 Webhook SMS — Hardcoded Fallback Coordinates

**File:** `apps/api/src/routes/webhooks.ts` lines 175-176

All SMS without location default to Makhachkala center `(42.9849, 47.5047)`. Users outside the city get wrong location data silently.

**Fix:** Return error requiring location, or log prominently that a fallback was used.

---

### 2.10 Help Request Claims — No Role Check

**File:** `apps/api/src/routes/helpRequests.ts` line 197

Any authenticated user can claim a help request. Should be restricted to volunteers+.

**Fix:** Add `requireRole("volunteer", "coordinator", "admin")` to the claim endpoint.

---

### 2.11 Shelters — Occupancy Can Exceed Capacity

**File:** `apps/api/src/routes/shelters.ts` line 137

No validation that `currentOccupancy <= capacity` on update. Can set occupancy to 500 on a 100-person shelter.

**Fix:** Add check: `if (body.currentOccupancy > existing.capacity) throw AppError(400, ...)`.

---

### 2.12 Backup Script — No Integrity Verification

**File:** `scripts/backup.sh`

Dumps database but never verifies the dump is readable. A corrupted backup is only discovered during a crisis when you try to restore.

**Fix:** Add `pg_restore --list` and checksum after dump:
```bash
pg_restore -l "$BACKUP_DIR/$FILENAME" > /tmp/manifest.txt
if [ $? -ne 0 ]; then echo "Backup corrupted!"; exit 1; fi
sha256sum "$BACKUP_DIR/$FILENAME" > "$BACKUP_DIR/$FILENAME.sha256"
```

---

## 3. Medium Priority

### API Middleware & Lib

| File | Line(s) | Issue | Fix |
|------|---------|-------|-----|
| `apps/api/src/config.ts` | 16 | `LOG_LEVEL` defaults to `"debug"` even in production | Default to `"info"`, enforce `"warn"` in prod |
| `apps/api/src/config.ts` | 14 | `WEBHOOK_API_KEY` defaults to empty string | Require min length in production |
| `apps/api/src/config.ts` | 10 | No validation of `JWT_EXPIRES_IN` format | Add regex: `z.string().regex(/^\d+[smhdwy]$/)` |
| `apps/api/src/middleware/apiKey.ts` | 13-16 | Dev bypass without logging | Add `logger.warn("Webhook auth bypassed in dev")` |
| `apps/api/src/middleware/apiKey.ts` | 26-31 | Failed auth attempts not logged | Add `logger.warn({ key: key?.slice(0,4) + "***" }, "Invalid webhook key")` |
| `apps/api/src/middleware/auth.ts` | 25-31 | Invalid tokens silently ignored in optionalAuth | Log at debug level |
| `apps/api/src/middleware/auth.ts` | 26 | Bearer token check is case-sensitive | Use `header?.toLowerCase().startsWith("bearer")` |
| `apps/api/src/middleware/auth.ts` | — | No JWT revocation/blacklist mechanism | Implement JTI tracking with Redis |
| `apps/api/src/middleware/rateLimiter.ts` | 50-51 | If limiters not initialized, middleware silently passes | Await initialization promise |
| `apps/api/src/middleware/rateLimiter.ts` | 60 | Anonymous rate limit by `req.ip` — spoofable via X-Forwarded-For | Configure `app.set("trust proxy", 1)` |
| `apps/api/src/middleware/rateLimiter.ts` | 26-31 | Memory leak in in-memory fallback (old keys never cleaned) | Add periodic cleanup or TTL |
| `apps/api/src/middleware/rateLimiter.ts` | 74-82 | Doesn't distinguish rate-limit-exceeded from Redis errors | Check `err instanceof RateLimiterRes` |
| `apps/api/src/middleware/validate.ts` | 14-22 | Validation failures not logged | Add `logger.debug({ path, errors }, "Validation failed")` |
| `apps/api/src/middleware/error.ts` | 40-46 | 500 responses don't include requestId for log correlation | Add `requestId` to error response |
| `apps/api/src/middleware/error.ts` | 38 | Full stack traces logged in production | Sanitize in production: log `message` only |
| `apps/api/src/index.ts` | 67 | CORS credentials=true with potentially broad origins | Restrict credentials in production |
| `apps/api/src/index.ts` | 109-111 | Scheduler failure doesn't crash the app — river data silently stale | Log fatal + require Redis in production |
| `apps/api/src/index.ts` | 121 | Graceful shutdown timeout hardcoded to 10s | Make configurable via env |
| `apps/api/src/index.ts` | 40-59 | Redis connection errors silently degrade | Require Redis in production or fail loudly |
| `apps/api/src/lib/logger.ts` | 34 | X-Request-ID accepted without validation — log injection possible | Validate UUID format |
| `apps/api/src/lib/logger.ts` | 49 | User ID logged in plain text (PII) | Hash or mask: `userId: sub?.slice(0, 8) + "..."` |
| `apps/api/src/lib/logger.ts` | 48 | User-Agent logged without sanitization | Strip `\r\n` characters |
| `apps/api/src/lib/statusTransitions.ts` | — | No concurrency control (no locking mechanism) | Use optimistic locking with version field |
| `apps/api/src/lib/spatial.ts` | 48, 71 | `getIdsWithinRadius()` can return millions of IDs, no LIMIT | Add LIMIT clause (default 1000) |
| `apps/api/src/lib/spatial.ts` | — | No query timeout on raw PostGIS queries | Add `SET statement_timeout = 5000` |
| `apps/api/src/lib/spatial.ts` | 133 | Epsilon could produce NaN at extreme zoom | Clamp: `Math.max(0.00001, ...)` |
| `apps/api/src/lib/spatial.ts` | 163 | `MODE()` aggregate can return NULL | Use `COALESCE(MODE()..., 'unknown')` |
| `apps/api/src/lib/emitter.ts` | — | No rate limiting on Socket.IO broadcast emissions | Add per-socket emission throttle |
| `apps/api/src/lib/emitter.ts` | 33, 35, 42 | `as unknown as` type casts bypass TypeScript | Extend Socket type properly |
| `apps/api/src/lib/metrics.ts` | 14, 21 | No cardinality explosion protection on route labels | Cap unique routes at 500 |
| `apps/api/src/lib/params.ts` | 8-11 | No validation of ID format (accepts any string) | Validate with regex |
| `apps/api/src/socket.ts` | 42-50 | Geo-subscription allows radius > 50,000 km | Cap at 5,000 km |
| `apps/api/src/socket.ts` | 50 | No subscription count limit per socket | Limit to 10 subscriptions |
| `apps/api/src/socket.ts` | 29-31 | Redis duplicate clients not cleaned up on error | Add error handlers |

---

### API Routes

| File | Line(s) | Issue | Fix |
|------|---------|-------|-----|
| `apps/api/src/routes/alerts.ts` | 99 | `channels` array not validated against enum values | Validate each value against Channel enum |
| `apps/api/src/routes/alerts.ts` | 97 | No validation on alert body length | Enforce max 5000 chars |
| `apps/api/src/routes/map.ts` | 16-18 | No zoom validation (0-28 range) | Add bounds check |
| `apps/api/src/routes/map.ts` | 50 | No limit on returned map points | Cap at 5000 |
| `apps/api/src/routes/weather.ts` | — | No handling of cache miss (returns undefined) | Default to empty array |
| `apps/api/src/routes/weather.ts` | — | No `Cache-Control` header | Set `public, max-age=300` |
| `apps/api/src/routes/seismic.ts` | 49 | Missing `next` parameter — errors don't propagate | Add error handler |
| `apps/api/src/routes/seismic.ts` | 50 | Unvalidated `req.params.id` before DB lookup | Use `paramId(req)` helper |
| `apps/api/src/routes/tiles.ts` | 214 | MapTiler API key logged in error messages | Redact from logs |
| `apps/api/src/routes/tiles.ts` | 198 | No validation on tile z/x/y coordinates | Validate: `z 0-28, x >= 0, y >= 0` |
| `apps/api/src/routes/tiles.ts` | 234-235 | Missing CORS headers on tile proxy | Add `Access-Control-Allow-Origin: *` |
| `apps/api/src/routes/riverLevels.ts` | 159 | Forecast endpoint returns all records unbounded | Add pagination (default limit 1000) |
| `apps/api/src/routes/riverLevels.ts` | 257 | No sanity check on `measuredAt` timestamp | Reject dates far in future/past |
| `apps/api/src/routes/riverLevels.ts` | 408 | Hardcoded `dangerLevelCm: 500` for Meshtastic | Look up from DAGESTAN_GAUGES config |
| `apps/api/src/routes/webhooks.ts` | 345-368 | SMS broadcast creates logs one-by-one (N+1) | Use `createMany()` |
| `apps/api/src/routes/webhooks.ts` | 383 | Meshtastic `node_id` not sanitized | Validate format: `/^[0-9a-f]{8}$/i` |
| `apps/api/src/routes/webhooks.ts` | 31-55 | SMS category aliases not validated against enum | Cross-check with HelpCategory enum |
| `apps/api/src/routes/webhooks.ts` | 321 | Unbounded SMS broadcast if each alert has many users | Add cap on total messages |
| `apps/api/src/routes/shelters.ts` | 162-174 | Can soft-delete occupied shelters | Block if `currentOccupancy > 0` |
| `apps/api/src/routes/channels.ts` | 48-50, 61-63 | Silent failures on DB errors (no logging) | Log errors at warn level |
| `apps/api/src/routes/channels.ts` | — | No staleness indicator in response | Add `lastChecked` timestamp |
| `apps/api/src/routes/authVk.ts` | 102 | Auto-registration without name validation | Require non-empty name |
| `apps/api/src/routes/authVk.ts` | 108 | No rate limiting on VK token generation | Add rate limit per vkUserId |
| `apps/api/src/routes/auth.ts` | — | No password complexity validation | Enforce min 8 chars with character diversity |
| `apps/api/src/routes/news.ts` | 30 | Category filter accepts arbitrary substring | Validate against predefined allowlist |
| `apps/api/src/routes/incidents.ts` | 56-65 | Includes author relation on all items (potential N+1) | Profile query plan; consider limit reduction |
| `apps/api/src/routes/incidents.ts` | 150-154 | `req.user!` non-null assertion — crash if undefined | Add explicit null check |
| `apps/api/src/routes/health.ts` | 10-14 | DB error silently suppressed | Log at error level |
| `apps/api/src/routes/metrics.ts` | 9 | No error handling on `registry.metrics()` | Wrap in try-catch |
| `apps/api/src/routes/helpRequests.ts` | 201-203 | Unclaim without permission validation | Check user is claimer or privileged role |

---

### API Services

| File | Line(s) | Issue | Fix |
|------|---------|-------|-----|
| All weather clients | — | Hardcoded API URLs in 6 files | Move to config/env |
| All weather clients | — | Duplicate `fetchJSON()` implementation in 5 files | Extract to shared `lib/fetch.ts` |
| `precipitationClient.ts` | 14 | Hardcoded URL `https://api.open-meteo.com/v1/forecast` | Move to env |
| `precipitationClient.ts` | 155-156 | Returns stale cache indefinitely on API failure | Add max stale age (e.g., `CACHE_TTL * 3`) |
| `precipitationClient.ts` | 151 | Type assertion `as T` without runtime validation | Add Zod schema validation |
| `precipitationClient.ts` | 174-176 | Null data silently skipped with only a continue | Log and count skipped points |
| `soilMoistureClient.ts` | 165 | NaN values pass `>= 0` check silently | Add `typeof val === 'number' && !isNaN(val)` |
| `soilMoistureClient.ts` | 142-151 | Timezone mismatch risk on "closest hour" search | Add explicit timezone handling |
| `soilMoistureClient.ts` | 171 | Partial data (1 of 4 layers) averaged without quality flag | Return `dataQuality: number` per reading |
| `snowClient.ts` | 52-60 | Hardcoded snowmelt parameters (DDF=3.5, density=0.35) | Move to config object |
| `snowClient.ts` | 240 | Division by zero if `h.time.length` is 0 | Check `totalHours > 0` |
| `snowClient.ts` | 224-226, 254-256 | Array index bounds not validated | Validate before access |
| `snowClient.ts` | 269 | Forecast dates not validated for format | Validate with regex: `/^\d{4}-\d{2}-\d{2}$/` |
| `snowClient.ts` | 27-48 | Mountain grid hardcoded (15 points) | Make configurable via env or DB |
| `openMeteoClient.ts` | 168 | Forecast detection by string comparison, no timezone | Use `Date.getTime()` comparison |
| `openMeteoClient.ts` | 161 | No bounds validation on discharge values | Check `discharge >= 0 && discharge < 10000` |
| `openMeteoClient.ts` | 122-127 | Response count mismatch returns empty (no error indicator) | Return error state, not empty Map |
| `openMeteoClient.ts` | 109 | Full URL logged (could expose API keys) | Truncate URL in logs |
| `earthquakeClient.ts` | 288 | Nearby station radius hardcoded at 30km | Make configurable |
| `earthquakeClient.ts` | 217, 224 | No coordinate bounds validation | Check lat -90..90, lng -180..180 |
| `earthquakeClient.ts` | 39-40, 287, 325 | Magnitude thresholds hardcoded | Move to config |
| `earthquakeClient.ts` | 307-320 | System user creation in hot path (every M5.0+ quake) | Create once at startup and cache |
| `earthquakeClient.ts` | 284, 346 | Duplicate WebSocket emissions possible | Move emit outside magnitude check |
| `newsFetcher.ts` | 26-37 | HTML stripping by regex — breaks on malformed HTML | Use proper sanitizer or cheerio |
| `newsFetcher.ts` | 83-107 | Filter logic unclear (category AND/OR keyword) | Document and test: currently OR |
| `newsFetcher.ts` | 129 | Date parsing error caught too late (article already built) | Skip article before processing |
| `newsFetcher.ts` | 21, 214-216 | `lastFetchTime` Map resets on restart (re-fetches all) | Persist to Redis or DB |
| `newsFetcher.ts` | 53-59 | Image URL extraction fragile (regex, no entity decode) | Validate URL and decode entities |
| `newsFeeds.ts` | 42, 52 | HTTP URLs for RSS feeds (not HTTPS) | Use HTTPS |
| `newsFeeds.ts` | 56-70 | Duplicate keywords in filter lists | Deduplicate with `Set` |
| `newsFeeds.ts` | 26 | Priority field defined but never implemented in queries | Implement in news query `orderBy` |
| `newsFeeds.ts` | — | Feed URLs hardcoded (require redeploy to change) | Move to DB or config file |
| `riverScraper.ts` | 143-147 | Russian month parsing case-sensitive, no validation | Use `.toLowerCase()` + validate month exists |
| `riverScraper.ts` | 199-204 | Trend thresholds hardcoded (2cm, 5%), not station-specific | Move to config |
| `riverScraper.ts` | 227-240 | Stale data (>24h) used without quality indicator | Cap at 7 days, add quality flag |
| `riverScraper.ts` | 290-291, 300-301 | Danger alert only triggers on upward crossing | Track previous state in DB |
| `riverScraper.ts` | 322-335 | System user creation in hot path | Move to startup, cache |
| `riverScraper.ts` | 104, 125, 181 | `parseFloat()` on regex captures without NaN check | Add `&& !isNaN(levelCm)` |
| `runoffClient.ts` | 54-94 | Terrain matching fragile (order-dependent, overlaps) | Add coverage validation at load time |
| `runoffClient.ts` | 176-177, 183-184 | Grid point matching by rounding (11km tolerance) | Use tolerance-based nearest-neighbor |
| `runoffClient.ts` | 143, 188, 193 | Magic numbers for AMC thresholds and risk levels | Extract to named constants |
| `runoffClient.ts` | 147 | Cache never invalidated when input caches expire | Recompute only when inputs are fresh |
| `gaugeStations.ts` | 39-355 | 360 lines of hardcoded data with no runtime validation | Add Zod validation at module load |
| `gaugeStations.ts` | — | Possible duplicate coordinates between stations | Add dedup check |
| `scheduler.ts` | 14-18 | Intervals not configurable from env | Move to config |

---

### PWA Frontend

| File | Line(s) | Issue | Fix |
|------|---------|-------|-----|
| `apps/pwa/src/pages/MapPage.tsx` | — | 767 lines — monolithic component | Extract into 5+ components (detail panels, legends, crisis hook) |
| `apps/pwa/src/pages/MapPage.tsx` | 82-142 | 7 identical fetch-with-error-handling functions | Use React Query or extract shared hook |
| `apps/pwa/src/pages/MapPage.tsx` | 200 | All 7 fetches fire on mount without batching | Use `Promise.all` |
| `apps/pwa/src/pages/MapPage.tsx` | 294-304 | Crisis detection runs on every render | Memoize with `useMemo` |
| `apps/pwa/src/pages/MapPage.tsx` | 83-127 | Fetch functions redefined every render | Wrap in `useCallback` |
| `apps/pwa/src/pages/MapPage.tsx` | 205 | Earthquake interval timer not cleaned up on remount | Return cleanup from useEffect |
| `apps/pwa/src/pages/MapPage.tsx` | 177-186 | Cache fallback doesn't indicate data source to user | Show "offline data" badge |
| `apps/pwa/src/pages/MapPage.tsx` | 315 | Detail panel embedded in MapPage (not reusable) | Extract to component |
| `apps/pwa/src/pages/MapPage.tsx` | 372 | Map legends inline (should be separate component) | Extract to `<MapLegend>` |
| `apps/pwa/src/components/map/MapView.tsx` | — | 900+ lines — largest component, not memoized | Wrap in `React.memo()` |
| `apps/pwa/src/components/map/MapView.tsx` | 341-359 | Popup HTML via string concatenation (XSS risk) | Use React portals or sanitize |
| `apps/pwa/src/components/map/MapView.tsx` | 166-312 | `setupSourcesAndLayers()` called multiple times, no dedup guard | Add layer existence cache |
| `apps/pwa/src/components/map/MapView.tsx` | 380 | Offline/online style switching logic fragile | Consolidate into single function |
| `apps/pwa/src/services/api.ts` | — | No retry logic, no timeout, no AbortController | Add all three |
| `apps/pwa/src/services/db.ts` | 41 | IndexedDB version hardcoded to 1, no migration path | Implement versioned migrations |
| `apps/pwa/src/services/db.ts` | — | No cache TTL or size limits | Add expiration and LRU eviction |
| `apps/pwa/src/services/db.ts` | 57-64 | cacheItems overwrites entire store | Merge instead |
| `apps/pwa/src/services/outbox.ts` | 40-48 | Retries on all errors equally (4xx and 5xx) | Only retry 5xx, drop 4xx |
| `apps/pwa/src/services/outbox.ts` | — | No exponential backoff | Add `delay = min(2^retryCount * 1000, 60000)` |
| `apps/pwa/src/services/outbox.ts` | — | No max age for old entries | Delete entries older than 7 days |
| `apps/pwa/src/services/outbox.ts` | — | No duplicate detection | Hash endpoint+body for dedup |
| `apps/pwa/src/services/socket.ts` | 8 | Socket persists after logout with old token | Disconnect on logout |
| `apps/pwa/src/services/socket.ts` | 10-18 | Token extraction duplicated from api.ts | Centralize token retrieval |
| `apps/pwa/src/services/socket.ts` | 21-28 | No max reconnection attempts | Limit to 10 |
| `apps/pwa/src/services/socket.ts` | — | No error event handling | Add explicit error handlers |
| `apps/pwa/src/store/auth.ts` | 30-36 | Token validated by type only, not expiry | Decode JWT and check `exp` |
| `apps/pwa/src/store/auth.ts` | — | No refresh token support | Implement refresh flow |
| `apps/pwa/src/store/auth.ts` | — | No logout on token expiration | Add automatic expiry logout |
| `apps/pwa/src/store/ui.ts` | 37 | Toast 4s timeout hardcoded | Make configurable |
| `apps/pwa/src/store/ui.ts` | — | No toast priority system | Critical alerts should skip queue |
| `apps/pwa/src/pages/HelpPage.tsx` | 88-98 | Socket listeners not cleaned up on unmount | Add proper cleanup |
| `apps/pwa/src/pages/HelpPage.tsx` | — | Hardcoded fallback coordinates (42.9849, 47.5047) | Default to user's geolocation |
| `apps/pwa/src/pages/HelpPage.tsx` | 35-65 | Scroll-based pagination can trigger multiple times | Debounce scroll handler |
| `apps/pwa/src/pages/HelpPage.tsx` | 177 | Modal close refreshes entire page data | Just prepend new item |
| `apps/pwa/src/pages/HelpPage.tsx` | — | No search/filter by keyword | Add keyword search |
| `apps/pwa/src/pages/AlertsPage.tsx` | 52 | New alerts prepended without pagination | Add pagination |
| `apps/pwa/src/pages/AlertsPage.tsx` | 44 | Hardcoded icon URL `/icons/icon-192.png` not verified | Verify exists |
| `apps/pwa/src/pages/AlertsPage.tsx` | 40-58 | Notification permission logic embedded in component | Centralize to main.tsx |
| `apps/pwa/src/pages/NewsPage.tsx` | 42 | Broken image silently hidden | Show placeholder |
| `apps/pwa/src/pages/NewsPage.tsx` | — | No feed filter persistence (resets on reload) | Persist to localStorage |
| `apps/pwa/src/pages/NewsPage.tsx` | — | No search functionality | Add title/summary search |
| `apps/pwa/src/pages/InfoPage.tsx` | 88-110 | Emergency phone numbers hardcoded | Fetch from backend |
| `apps/pwa/src/pages/InfoPage.tsx` | 32-37 | Manual sort on every render | Memoize sorted shelters |
| `apps/pwa/src/pages/InfoPage.tsx` | — | No socket subscription for shelter updates | Subscribe to `shelter:updated` |
| `apps/pwa/src/pages/LoginPage.tsx` | — | No password strength indicator | Add one |
| `apps/pwa/src/pages/LoginPage.tsx` | — | No "forgot password" flow | Add flow |
| `apps/pwa/src/components/map/ReportForm.tsx` | 39-48 | 7 separate `useState` calls | Consolidate into `useReducer` |
| `apps/pwa/src/components/map/ReportForm.tsx` | — | No form draft persistence | Save to localStorage mid-flow |
| `apps/pwa/src/components/map/ReportForm.tsx` | 77 | No retry UI for geolocation failure | Add retry button |
| `apps/pwa/src/components/map/ReportForm.tsx` | — | No step progress indicator | Add step indicator |
| `apps/pwa/src/components/map/ReportForm.tsx` | 99-101, 119-121 | Offline outbox logic duplicated | Extract to helper hook |
| `apps/pwa/src/components/BottomSheet.tsx` | — | No body scroll lock, no focus trap | Add both |
| `apps/pwa/src/components/BottomSheet.tsx` | — | No back-gesture support (Android) | Add `popstate` listener |
| `apps/pwa/src/components/BottomSheet.tsx` | — | Missing `aria-modal="true"` | Add it |
| `apps/pwa/src/components/Toast.tsx` | — | No ARIA live region | Add `role="status" aria-live="polite"` |
| `apps/pwa/src/components/Spinner.tsx` | — | No CSS class defined, no `aria-busy` | Add animation + accessibility |
| `apps/pwa/src/components/ErrorBoundary.tsx` | 21 | Error logging to console only | Send to Sentry/error tracking |
| `apps/pwa/src/components/ErrorBoundary.tsx` | 27-46 | Inline styles instead of CSS classes | Use CSS classes |
| `apps/pwa/src/components/CategoryChip.tsx` | 10 | Missing `aria-pressed` | Add `aria-pressed={active}` |
| `apps/pwa/src/components/UrgencyBadge.tsx` | 23 | Fallback color not from CSS variable | Use `var(--color-muted)` |
| `apps/pwa/src/components/map/LayerToggle.tsx` | 34 | Panel not dismissed on Escape key | Add handler |
| `apps/pwa/src/components/Layout.tsx` | 30 | `crisisRivers.join(", р. ")` broken for single river | Check length === 1 |
| `apps/pwa/src/hooks/useApi.ts` | — | No abort signal support (requests continue after unmount) | Add AbortController |
| `apps/pwa/src/hooks/useApi.ts` | — | No retry logic | Add exponential backoff |
| `apps/pwa/src/hooks/useGeolocation.ts` | 49 | `maximumAge: 60000` too aggressive for emergency | Reduce to 30s |
| `apps/pwa/src/hooks/useOnline.ts` | — | No debouncing on rapid transitions | Add 500ms debounce |
| `apps/pwa/src/hooks/useSocket.ts` | 18-20 | Type casting `as unknown` — no payload validation | Add Zod runtime validation |
| `apps/pwa/src/main.tsx` | 14 | Silent error on service worker registration | Log to monitoring |
| `apps/pwa/src/main.tsx` | 22-28 | Notification permission on first click (unintuitive) | Request with explicit user action + context |
| `apps/pwa/src/main.tsx` | 8 | `startOutboxPolling()` without checking online status | Check online first |
| `apps/pwa/src/index.css` | — | No `prefers-reduced-motion` media query | Add for all animations |
| `apps/pwa/src/index.css` | — | No dark mode support | Add via CSS custom properties |
| `apps/pwa/src/index.css` | — | No print styles | Add for emergency info pages |
| `apps/pwa/src/index.css` | 30 | `overflow-x: hidden` on body can break features | Remove or scope to main containers |
| `apps/pwa/src/index.css` | 305-311 | MapLibre spinner hidden with `!important` | Use proper CSS specificity |
| All admin pages | — | No confirmation dialogs before destructive actions | Add confirm modals |
| All admin pages | — | No pagination for large result sets | Add pagination |
| All admin pages | — | No skeleton loading states | Add skeleton loaders |
| All admin pages | — | No bulk actions | Add bulk select + action |
| `AdminPage.tsx` > `AlertComposer` | 29 | Validates channels but not urgency/title/body | Add proper validation |
| `AdminPage.tsx` > `RiverLevelsEditor` | 90-91 | Hardcoded default coords | Use user geolocation |
| `AdminPage.tsx` > `StatsDashboard` | 86-87 | Pie chart labels overlap | Add responsive layout |

---

### Telegram Bot

| File | Line(s) | Issue | Fix |
|------|---------|-------|-----|
| `apps/telegram/src/index.ts` | — | No rate limit on callback queries | Add per-user throttle |
| `apps/telegram/src/index.ts` | — | Command shortcuts re-send messages as text (duplicate processing) | Call handlers directly |
| `apps/telegram/src/index.ts` | — | No validation of callback_data format | Validate before string operations |
| `apps/telegram/src/config.ts` | — | Weak validation (only TG_BOT_TOKEN checked) | Validate all required vars |
| `apps/telegram/src/config.ts` | — | `API_INTERNAL_TOKEN` may be empty | Require or warn |
| `apps/telegram/src/state.ts` | — | All state lost on restart (incomplete flows vanish) | Persist to Redis/DB |
| `apps/telegram/src/state.ts` | — | Memory grows unbounded if cleanup misses entries | Add size limit |
| `apps/telegram/src/state.ts` | — | Hardcoded 10-minute TTL | Make configurable |
| `apps/telegram/src/api.ts` | — | No retry logic on network failures | Add 3 retries with backoff |
| `apps/telegram/src/api.ts` | — | No timeout on fetch calls | Add 15s timeout |
| `apps/telegram/src/api.ts` | — | Uses `tg_${tgId}` as phone (hacky auth) | Use server-side tgId lookup |
| `apps/telegram/src/api.ts` | — | Hardcoded limit=10 and limit=20 | Make configurable |
| `apps/telegram/src/auth.ts` | — | Silent fallback if register also fails | Propagate error |
| `apps/telegram/src/auth.ts` | — | No token expiry validation | Check `exp` before use |
| `apps/telegram/src/auth.ts` | — | Race condition on concurrent auth for same user | Add locking |
| `apps/telegram/src/broadcast.ts` | — | Subscribers in memory, lost on restart | Persist to DB |
| `apps/telegram/src/broadcast.ts` | — | No message deduplication for alerts | Add idempotency key |
| `apps/telegram/src/broadcast.ts` | — | Fixed 2s reconnect delay (no backoff) | Implement exponential backoff |
| `apps/telegram/src/broadcast.ts` | 48 | Type casting `socket` to `unknown` | Properly type Socket |
| `apps/telegram/src/queue.ts` | — | Queue not persisted (lost on crash) | Persist to file/DB |
| `apps/telegram/src/queue.ts` | — | Fixed 30s retry, no backoff | Exponential backoff |
| `apps/telegram/src/queue.ts` | — | No max queue size | Add cap with overflow handling |
| `apps/telegram/src/queue.ts` | — | No duplicate detection | Hash method+path+body |
| `apps/telegram/src/rateLimit.ts` | — | Memory never cleaned up | Add periodic cleanup |
| `apps/telegram/src/rateLimit.ts` | — | No per-action-type limits | Separate limits for report vs help |
| `apps/telegram/src/rateLimit.ts` | — | Error message doesn't include reset time | Show "try again in X minutes" |
| `apps/telegram/src/handlers/start.ts` | 15 | Auth errors swallowed silently | Show "trouble connecting" |
| `apps/telegram/src/handlers/start.ts` | — | No first-time vs returning user differentiation | Store first-contact timestamp |
| `apps/telegram/src/handlers/report.ts` | 120-122 | Hardcoded Makhachkala coords as default | Require location or show warning |
| `apps/telegram/src/handlers/report.ts` | — | No confirmation step before submit | Add review screen |
| `apps/telegram/src/handlers/report.ts` | — | No description length validation | Max 500 chars |
| `apps/telegram/src/handlers/report.ts` | 238 | Queue fallback loses photoUrls | Handle photo re-upload |
| `apps/telegram/src/handlers/report.ts` | — | No rate limit on step transitions | Add debounce |
| `apps/telegram/src/handlers/help.ts` | — | Same issues as report.ts | Same fixes |
| `apps/telegram/src/handlers/help.ts` | 219 | Need vs offer urgency not differentiated | Map separately |
| `apps/telegram/src/handlers/help.ts` | — | Contact phone accepts any text (no validation) | Add basic regex |
| `apps/telegram/src/handlers/help.ts`, `report.ts`, `group.ts` | — | Duplicate location validation logic | Extract to shared function |
| `apps/telegram/src/handlers/status.ts` | — | No pagination, hardcoded limits | Add "show more" button |
| `apps/telegram/src/handlers/status.ts` | — | Cancel only for help requests, not incidents | Implement incident cancellation |
| `apps/telegram/src/handlers/shelters.ts` | — | Hardcoded limit=5, no indication of more | Show "5 of N shelters" |
| `apps/telegram/src/handlers/shelters.ts` | — | Full shelters shown without deprioritization | Highlight/deprioritize full |
| `apps/telegram/src/handlers/alerts.ts` | — | No auto-refresh, no filtering | Sort critical first, add refresh |
| `apps/telegram/src/handlers/level.ts` | — | No historical data (one-time snapshot) | Include previous measurement |
| `apps/telegram/src/handlers/group.ts` | — | No group-admin permission check | Add check |
| `apps/telegram/src/handlers/group.ts` | — | Hardcoded severity=medium | Allow severity parameter |
| `apps/telegram/src/handlers/text.ts` | 9, 14, 19 | Intent patterns fragile (no fuzzy matching) | Add fuzzy matching |
| `apps/telegram/src/handlers/text.ts` | 79-89 | Keyboard menu duplicates start.ts | Load from central config |

---

### VK Mini App

| File | Line(s) | Issue | Fix |
|------|---------|-------|-----|
| `apps/vk/src/App.tsx` | 52 | Silent auth failure, no retry | Show status banner + retry with backoff |
| `apps/vk/src/App.tsx` | — | Auth state not exposed to panels | Use React Context |
| `apps/vk/src/App.tsx` | — | Loading spinner can hang indefinitely | Add 30s timeout |
| `apps/vk/src/services/api.ts` | — | No token refresh, no timeout, no retry | Add all three |
| `apps/vk/src/services/api.ts` | — | Global mutable `authToken` (race condition) | Use localStorage getter |
| `apps/vk/src/services/vkbridge.ts` | — | `long` vs `lng` naming inconsistency | Rename to `lng` |
| `apps/vk/src/services/vkbridge.ts` | — | Returns null on any geo error (no reason given) | Add error details |
| `apps/vk/src/services/vkbridge.ts` | — | No timeout on VK Bridge calls | Add timeout |
| `apps/vk/src/hooks/useNav.ts` | — | History grows unbounded | Limit to 10 items |
| `apps/vk/src/hooks/useNav.ts` | — | `goBack` doesn't validate panel existence | Validate against known panels |
| `apps/vk/src/panels/MapPanel.tsx` | — | No map error handling | Register `map.on("error")` |
| `apps/vk/src/panels/MapPanel.tsx` | — | No data refresh after initial load | Add auto-refresh or WebSocket |
| `apps/vk/src/panels/MapPanel.tsx` | — | No feature clustering (100 points cluttered) | Add MarkerCluster |
| `apps/vk/src/panels/MapPanel.tsx` | — | Click handlers not cleaned up on unmount | Add cleanup |
| `apps/vk/src/panels/MapPanel.tsx` | — | No keyboard navigation on map | Add shortcuts |
| `apps/vk/src/panels/ReportPanel.tsx` | — | Hardcoded default coords (42.9849, 47.5047) | Show fallback warning |
| `apps/vk/src/panels/ReportPanel.tsx` | — | No offline queue (data lost on failure) | Add localStorage queue |
| `apps/vk/src/panels/ReportPanel.tsx` | — | No photo upload support | Add if API supports |
| `apps/vk/src/panels/ReportPanel.tsx` | — | Snackbar auto-closes in 1.5s (too fast) | Increase to 3s |
| `apps/vk/src/panels/HelpPanel.tsx` | — | No pagination (only 20 items) | Add "load more" |
| `apps/vk/src/panels/HelpPanel.tsx` | — | No auto-refresh | Auto-refresh every 60s |
| `apps/vk/src/panels/HelpPanel.tsx` | — | No distance sorting | Add near-to-far sort |
| `apps/vk/src/panels/HelpFormPanel.tsx` | — | Same issues as ReportPanel | Same fixes |
| `apps/vk/src/panels/HelpFormPanel.tsx` | — | Phone format not validated | Add basic regex |
| `apps/vk/src/panels/AlertsPanel.tsx` | — | No auto-refresh | Add 30s auto-refresh or WebSocket |
| `apps/vk/src/panels/AlertsPanel.tsx` | — | No alert age indicator | Show "5 min ago" |
| `apps/vk/src/panels/AlertsPanel.tsx` | — | Hardcoded urgency emoji/colors | Use constants from shared |
| `apps/vk/src/panels/InfoPanel.tsx` | — | Phone numbers not copyable | Add copy-to-clipboard |
| `apps/vk/src/panels/InfoPanel.tsx` | — | No pagination for shelters | Add "load more" |
| All VK panels | — | No real-time updates (no WebSocket) | Add Socket.IO client |

---

### Infrastructure

| File | Issue | Fix |
|------|-------|-----|
| `docker-compose.prod.yml` | API memory limit 512MB — may OOM | Increase to 1GB+ |
| `docker-compose.prod.yml` | No log rotation (`json-file` driver) | Add `max-size: 10m, max-file: 3` |
| `docker-compose.yml` | pgAdmin with hardcoded default credentials | Remove or add auth config |
| `docker-compose.yml` | No health checks on api/pwa services | Add health checks |
| `monitoring/prometheus.yml` | Only scrapes API — missing Redis, Postgres, Nginx | Add exporters |
| `monitoring/prometheus.yml` | No alert rules defined | Add error rate, latency, disk alerts |
| `monitoring/prometheus.yml` | No retention policy specified | Configure retention |
| `nginx/conf.d/samur.conf.https-ready` | Rate limiting not on root `/` | Add protection |
| `nginx/conf.d/samur.conf.https-ready` | Missing gzip in HTTPS block | Add explicit `gzip on` |
| `nginx/nginx.conf` | No request ID tracking for distributed tracing | Add `$request_id` |
| `nginx/nginx.conf` | HTML not in gzip_types | Add `text/html` |
| `scripts/deploy.sh` | No rollback mechanism | Add version tagging |
| `scripts/deploy.sh` | Health check uses `wget --spider` (fragile) | Use `curl --fail` |
| `scripts/deploy.sh` | No smoke tests post-deploy | Add API endpoint tests |
| `scripts/deploy.sh` | Missing `set -o pipefail` | Add it |
| `scripts/init-ssl.sh` | Overwrites nginx config without atomic swap | Use `mv` from temp |
| `scripts/init-ssl.sh` | No check for existing valid cert | Check expiry first |
| `scripts/meshtastic-bridge/bridge.py` | Thread race on `_running` flag | Use `threading.Event` |
| `scripts/meshtastic-bridge/bridge.py` | UTF-8 truncation not boundary-aware | Use `.encode()[:max].decode(errors='ignore')` |
| `scripts/meshtastic-bridge/bridge.py` | No message deduplication from mesh repeats | Add time-windowed hash cache |
| `scripts/meshtastic-bridge/bridge.py` | No GPS accuracy/freshness validation | Validate before use |
| `scripts/meshtastic-bridge/requirements.txt` | No version pinning | Pin with `==` |

---

### Shared Packages

| File | Issue | Fix |
|------|-------|-----|
| `packages/shared/src/types/index.ts` | Timestamps typed as `string`, no ISO-8601 enforcement | Add branded type or Zod transform |
| `packages/shared/src/types/index.ts` | `ChannelHeartbeat` interface not exported | Export it |
| `packages/shared/src/types/index.ts` | WebSocket event types lack ack/error typing | Add proper generics |
| `packages/shared/src/schemas/index.ts` | `CreateIncidentSchema` no userId field | Set from auth middleware |
| `packages/shared/src/schemas/index.ts` | `CreateAlertSchema` channels not validated against enum | Add `.refine()` |
| `packages/shared/src/schemas/index.ts` | `GeoFilterSchema` radius can extend outside Dagestan | Add bounds check |
| `packages/shared/src/schemas/index.ts` | Text fields lack max length in schema | Add `.max(2000)` |
| `packages/shared/src/schemas/index.ts` | No XSS sanitization on text fields | Add DOMPurify transform |
| `packages/shared/src/schemas/index.ts` | No schema for batch operations | Add batch create schemas |
| `packages/shared/src/utils/index.ts` | Russian pluralization hardcoded (no i18n) | Add locale parameter |
| `packages/shared/src/utils/index.ts` | `isInBounds()` exported but never used | Wire up or remove |
| `packages/shared/src/constants/index.ts` | `DAGESTAN_BOUNDS` duplicated in bridge.py | Centralize source of truth |
| `packages/shared/src/constants/index.ts` | `TILE_CACHE_ZOOM_RANGE` defined but unused in code | Remove or implement |
| `packages/shared/src/constants/index.ts` | No `CHANNEL_LABELS` constant | Add it |
| `packages/db/prisma/schema.prisma` | Missing `updatedAt` on Earthquake, NewsArticle, SmsBroadcastLog, ChannelHeartbeat | Add column |
| `packages/db/prisma/schema.prisma` | Missing soft-delete on Earthquake, NewsArticle | Add `deletedAt` |
| `packages/db/prisma/schema.prisma` | `ChannelHeartbeat.channel` is `String @id` but should be enum | Use Channel enum or validate |
| `packages/db/prisma/schema.prisma` | `RiverLevel` has many optional discharge fields — denormalized | Consider `DischargeStats` table |
| `packages/db/src/seed.ts` | Hardcoded bcrypt hashes (placeholders, not real hashes) | Use `bcryptjs` dynamically |
| `packages/db/src/seed.ts` | Uses `$executeRawUnsafe` | Use parameterized queries |
| `packages/db/src/seed.ts` | No seed data for Earthquake or NewsArticle | Add sample data |
| Migration `20260408000000` | Redundant GIST indexes (already in init) | Remove duplicates |
| Migration `20260409_add_earthquakes` | No spatial index on earthquake location | Add GIST index on (lat, lng) |

---

## 4. Low Priority

### Test Coverage

**Zero tests exist for all services** (3,000+ lines of critical data-fetching code). Existing tests cover only 6 route files.

**Priority test targets:**

| File | Lines | What to test |
|------|-------|-------------|
| `riverScraper.ts` | 607 | Snapshot-test HTML parsing against real page samples |
| `earthquakeClient.ts` | 365 | Dedup logic, coordinate validation, alert thresholds |
| `newsFetcher.ts` | 240 | Filter combinations (category AND/OR keyword), HTML stripping |
| `runoffClient.ts` | 217 | Terrain matching, grid point matching edge cases |
| `snowClient.ts` | 306 | Melt index computation, date parsing |
| `statusTransitions.ts` | 63 | All valid/invalid transition paths |
| `scheduler.ts` | 230 | Interval management, timeout handling, shutdown cleanup |
| `openMeteoClient.ts` | 190 | Response normalization, array length checking |

**Frontend test targets:**
- PWA: No tests at all — need component tests for MapPage, ReportForm, HelpPage
- Telegram: No tests — need handler tests for report flow, help flow
- VK: No tests — need panel tests for ReportPanel, HelpFormPanel

---

### Code Organization

| Issue | Files Affected | Fix |
|-------|---------------|-----|
| Duplicate `fetchJSON()` in 5 service files | precipitationClient, soilMoistureClient, snowClient, earthquakeClient, openMeteoClient | Extract to `apps/api/src/lib/fetch.ts` |
| Hardcoded `(42.9849, 47.5047)` in 5+ files | webhooks.ts, report.ts (TG), help.ts (TG), ReportPanel.tsx (VK), HelpFormPanel.tsx (VK) | Extract to `@samur/shared/constants` |
| Duplicate location validation | TG report.ts, help.ts, group.ts | Extract to `apps/telegram/src/utils/validation.ts` |
| Duplicate token extraction | PWA api.ts, socket.ts, outbox.ts | Centralize in `apps/pwa/src/services/token.ts` |
| News feeds config in code | newsFeeds.ts | Move to database or external config |
| Emergency phone numbers in code | PWA InfoPage.tsx | Fetch from backend or config |

---

### Accessibility & i18n

| Area | Issue | Fix |
|------|-------|-----|
| i18n | All UI strings hardcoded in Russian across all apps | Add i18n framework (react-intl or i18next) |
| Motion | No `prefers-reduced-motion` media query in CSS | Add for all animations |
| Dark mode | No dark mode support | Add via CSS custom properties toggle |
| Print | No print styles for emergency info | Add print-friendly CSS |
| Focus | No focus traps in bottom sheets/modals | Add focus trap library |
| ARIA | Missing `aria-modal`, `aria-busy`, `aria-pressed` in multiple components | Add proper ARIA attributes |
| Skip link | Skip link focus management incomplete | Manage focus properly |
| Keyboard | Map components have no keyboard navigation | Add arrow keys, +/-, shortcuts |
| Contrast | Some badge color combos may fail WCAG AA | Verify all combinations |

---

### Features Not Yet Implemented

| Feature | Current State | Impact |
|---------|--------------|--------|
| File uploads | `photoUrls` is string array but no upload endpoint | Users can't attach photos to reports |
| Password reset | No forgot-password flow | Users locked out if password lost |
| Background Sync API | PWA uses polling instead of service worker sync | Less reliable offline sync |
| Request deduplication | Rapid taps can create duplicate records | Data quality |
| Sentry / error monitoring | Unhandled exceptions only go to stdout | Can't monitor production errors |
| Token refresh | JWT expires after 7d with no refresh mechanism | Users must re-login weekly |
| Notification scheduling | Alerts are immediate only | Can't schedule future alerts |
| User preferences | No settings page in any app | Users can't configure notifications, language, etc. |
| Analytics dashboard | Stats page is basic | Coordinators need trend analysis |
| Export/sharing | No data export capability | Can't share incident reports externally |
| Multi-language | Russian only | Excludes non-Russian speakers in region |

---

## 5. Recommended Execution Order

### Week 1 — Security (Critical) ✅
- [x] Schema indexes + constraints (migration)
- [x] Socket.IO authentication middleware
- [x] Timing-safe API key comparison (`crypto.timingSafeEqual`)
- [x] Force `role: "resident"` on registration
- [x] SQL injection whitelist in `spatial.ts`
- [x] XSS fix in VK map popups
- [x] VK auth production guard
- [x] Nginx CSP fix

### Week 2 — Data Integrity (High) ✅
- [x] Status transition locking (optimistic locking with version field)
- [x] Distributed scheduler locks (Redis `SET NX EX`)
- [x] Earthquake alert retry + dedup fix
- [x] River scraper DB batching (`createMany`)
- [x] News fetcher Prisma error code check (`P2002`)
- [x] Shelter occupancy validation
- [x] Help request role check on claims

### Week 3 — Reliability (High/Medium) ✅
- [x] Extract shared `fetchJSON` utility
- [x] Cache staleness limits (all weather clients)
- [x] Scheduler task timeouts (`Promise.race`)
- [x] Backup integrity verification
- [x] Docker log rotation
- [x] API memory limit increase
- [x] Config validation improvements (LOG_LEVEL, WEBHOOK_API_KEY)

### Week 4 — Frontend (Medium) ✅
- [x] MapPage/MapView decomposition (5+ components)
- [ ] React Query adoption for data fetching (deferred — requires significant refactor)
- [x] Socket cleanup on logout
- [x] Token expiry checks in auth store
- [x] Offline queue improvements (backoff, dedup, 5xx-only retry)
- [x] Admin page confirmation dialogs

### Week 5 — Telegram & VK (Medium)
- [x] Telegram: persist state + subscribers to Redis
- [x] Telegram: queue persistence
- [x] Telegram: API retry + timeout
- [x] VK: add Socket.IO for real-time
- [x] VK: offline queue
- [x] Both: extract shared location validation

### Week 6+ — Quality (Low)
- [ ] Service test suite (riverScraper, earthquakeClient, newsFetcher, etc.)
- [ ] i18n framework setup
- [ ] Dark mode + prefers-reduced-motion
- [ ] Sentry integration
- [ ] Prometheus alerting rules + expanded scraping
- [ ] Deploy rollback mechanism
- [ ] Meshtastic bridge thread safety + dedup

---

## Issue Counts by Severity

| Severity | Count |
|----------|-------|
| Critical (security/data integrity) | 8 |
| High (reliability/correctness) | 12 |
| Medium (robustness/UX) | ~120 |
| Low (quality of life) | ~40 |
| **Total** | **~180** |

---

*Generated by Claude Opus 4.6 on 2026-04-09. This document should be treated as a living checklist — mark items as completed and re-audit quarterly.*
