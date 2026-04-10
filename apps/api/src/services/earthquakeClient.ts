// SPDX-License-Identifier: AGPL-3.0-only

/**
 * USGS Earthquake API client for Dagestan / Caucasus region.
 *
 * Polls the USGS FDSN event API every 5 minutes for M3.5+ earthquakes
 * within the Caucasus bounding box. Stores events in the database
 * (deduped by usgsId) and triggers alerts for significant events.
 *
 * Dagestan is in an active seismic zone — earthquakes can trigger
 * landslides that dam rivers, causing catastrophic flash floods.
 */

import { logger } from "../lib/logger.js";
import { fetchJSON } from "../lib/fetch.js";
import { prisma } from "@samur/db";
import { emitAlertBroadcast, emitEarthquakeNew } from "../lib/emitter.js";
import type { Alert, EarthquakeEvent } from "@samur/shared";

const log = logger.child({ service: "earthquake" });

// ── Config ──────────────────────────────────────────────────────────────

const USGS_API = "https://earthquake.usgs.gov/fdsnws/event/1/query";

/** Caucasus bounding box (covers Dagestan + surrounding seismic zone) */
const BBOX = {
  minlat: 41.0,
  maxlat: 44.5,
  minlon: 44.0,
  maxlon: 49.0,
} as const;

const MIN_MAGNITUDE = 3.5;
const LOOKBACK_DAYS = 7;

/** Alert thresholds */
const ALERT_MAG_WEBSOCKET = 4.5; // push to nearby clients
const ALERT_MAG_BROADCAST = 5.0; // full multi-channel alert

// ── Types ───────────────────────────────────────────────────────────────

interface UsgsFeature {
  id: string;
  properties: {
    mag: number | null;
    place: string | null;
    time: number; // epoch ms
    felt: number | null;
    mmi: number | null;
    type: string;
  };
  geometry: {
    coordinates: [number, number, number]; // [lng, lat, depthKm]
  };
}

interface UsgsResponse {
  type: "FeatureCollection";
  features: UsgsFeature[];
}

// ── In-memory cache for API responses ───────────────────────────────────

let cachedEvents: EarthquakeEvent[] = [];
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function getCachedEarthquakes(): EarthquakeEvent[] {
  return cachedEvents;
}

export function isEarthquakeCacheStale(): boolean {
  return Date.now() - cachedAt > CACHE_TTL_MS;
}

/** Prune stale alert dedup entries (safe to call from external scheduler) */
export function pruneAlertDedup(): void {
  pruneAlertedIds();
}

// ── Track alerted events (prevent duplicate alerts) ─────────────────────
// Map<usgsId, timestamp> with 7-day TTL to prevent unbounded growth

const alertedUsgsIds = new Map<string, number>();
const ALERT_DEDUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ALERT_DEDUP_MAX_SIZE = 500;

function pruneAlertedIds(): void {
  const cutoff = Date.now() - ALERT_DEDUP_TTL_MS;
  for (const [id, ts] of alertedUsgsIds) {
    if (ts < cutoff) alertedUsgsIds.delete(id);
  }
  // Hard cap: if still too large, evict oldest entries
  if (alertedUsgsIds.size > ALERT_DEDUP_MAX_SIZE) {
    const sorted = [...alertedUsgsIds.entries()].sort((a, b) => a[1] - b[1]);
    const toRemove = sorted.slice(0, alertedUsgsIds.size - ALERT_DEDUP_MAX_SIZE);
    for (const [id] of toRemove) alertedUsgsIds.delete(id);
  }
}

// ── River stations for proximity warnings ───────────────────────────────

interface RiverStation {
  name: string;
  river: string;
  lat: number;
  lng: number;
}

/**
 * Monitored river stations — used to cross-reference earthquakes
 * with river valleys for landslide/dam risk warnings.
 */
const RIVER_STATIONS: RiverStation[] = [
  { name: "Бабаюрт", river: "Терек", lat: 43.60, lng: 46.78 },
  { name: "Хасавюрт", river: "Акташ", lat: 43.25, lng: 46.59 },
  { name: "Кизилюрт", river: "Сулак", lat: 43.02, lng: 46.87 },
  { name: "Чирюрт", river: "Сулак", lat: 43.04, lng: 46.93 },
  { name: "Махачкала", river: "Шура-Озень", lat: 42.98, lng: 47.50 },
  { name: "Дербент", river: "Самур", lat: 42.07, lng: 48.29 },
  { name: "Ахты", river: "Самур", lat: 41.46, lng: 47.74 },
  { name: "Магарамкент", river: "Самур", lat: 41.61, lng: 48.16 },
  { name: "Буйнакск", river: "Шура-Озень", lat: 42.82, lng: 47.12 },
  { name: "Кизляр", river: "Терек", lat: 43.85, lng: 46.72 },
  { name: "Ботлих", river: "Андийское Койсу", lat: 42.67, lng: 46.22 },
  { name: "Гергебиль", river: "Казикумухское Койсу", lat: 42.42, lng: 47.07 },
  { name: "Гуниб", river: "Каракойсу", lat: 42.38, lng: 46.95 },
  { name: "Тлярата", river: "Аварское Койсу", lat: 42.28, lng: 46.63 },
  { name: "Цудахар", river: "Казикумухское Койсу", lat: 42.29, lng: 47.07 },
];

/** Haversine distance in km (simplified) */
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Find river stations within a given radius of an earthquake */
function findNearbyStations(lat: number, lng: number, radiusKm: number): Array<RiverStation & { distanceKm: number }> {
  return RIVER_STATIONS
    .map((s) => ({ ...s, distanceKm: Math.round(distanceKm(lat, lng, s.lat, s.lng)) }))
    .filter((s) => s.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

// ── Main fetch ──────────────────────────────────────────────────────────

/**
 * Fetch recent earthquakes from USGS, store to DB, trigger alerts for M4.5+.
 */
export async function fetchEarthquakes(): Promise<EarthquakeEvent[]> {
  const startTime = new Date();
  startTime.setDate(startTime.getDate() - LOOKBACK_DAYS);

  const params = new URLSearchParams({
    format: "geojson",
    minlatitude: String(BBOX.minlat),
    maxlatitude: String(BBOX.maxlat),
    minlongitude: String(BBOX.minlon),
    maxlongitude: String(BBOX.maxlon),
    minmagnitude: String(MIN_MAGNITUDE),
    starttime: startTime.toISOString().split("T")[0],
    orderby: "time",
  });

  const url = `${USGS_API}?${params}`;
  log.info("Fetching earthquakes from USGS");

  const data = await fetchJSON<UsgsResponse>(url, { service: "earthquake" });

  if (!data || !Array.isArray(data.features)) {
    log.error("USGS earthquake API returned no data");
    return cachedEvents;
  }

  const events: EarthquakeEvent[] = [];

  // Prune stale alert dedup entries
  pruneAlertedIds();

  for (const feature of data.features) {
    const { properties: p, geometry: g } = feature;
    if (!p || !g || p.type !== "earthquake") continue;
    if (p.mag === null || p.mag < MIN_MAGNITUDE) continue;
    if (!Array.isArray(g.coordinates) || g.coordinates.length < 3) continue;

    const [lng, lat, depthKm] = g.coordinates;

    const event: EarthquakeEvent = {
      id: "", // will be set after DB upsert
      usgsId: feature.id,
      magnitude: Math.round(p.mag * 10) / 10,
      depth: Math.round(depthKm * 10) / 10,
      lat: Math.round(lat * 1000) / 1000,
      lng: Math.round(lng * 1000) / 1000,
      place: p.place ?? "Unknown location",
      time: new Date(p.time).toISOString(),
      felt: p.felt ?? null,
      mmi: p.mmi !== null ? Math.round(p.mmi * 10) / 10 : null,
      source: "usgs",
    };

    // Upsert to DB (dedup by usgsId)
    try {
      const record = await prisma.earthquake.upsert({
        where: { usgsId: event.usgsId },
        create: {
          usgsId: event.usgsId,
          magnitude: event.magnitude,
          depth: event.depth,
          lat: event.lat,
          lng: event.lng,
          place: event.place,
          time: new Date(event.time),
          felt: event.felt,
          mmi: event.mmi,
          source: event.source,
        },
        update: {
          magnitude: event.magnitude,
          depth: event.depth,
          felt: event.felt,
          mmi: event.mmi,
        },
      });

      event.id = record.id;
      events.push(event);

      // Check if this event needs an alert
      await checkAndTriggerEarthquakeAlert(event);
    } catch (err) {
      log.error({ err, usgsId: event.usgsId }, "Failed to upsert earthquake");
    }
  }

  // Update cache
  cachedEvents = events;
  cachedAt = Date.now();

  const significant = events.filter((e) => e.magnitude >= ALERT_MAG_WEBSOCKET).length;
  log.info({ total: events.length, significant }, "Earthquake data updated");

  return events;
}

// ── Alert logic ─────────────────────────────────────────────────────────

async function checkAndTriggerEarthquakeAlert(event: EarthquakeEvent): Promise<void> {
  if (event.magnitude < ALERT_MAG_WEBSOCKET) return;
  if (alertedUsgsIds.has(event.usgsId)) return;

  // Emit WebSocket event for M4.5+ (event.id is set after DB upsert)
  emitEarthquakeNew(event);

  // Full multi-channel alert for M5.0+
  if (event.magnitude >= ALERT_MAG_BROADCAST) {
    const nearbyStations = findNearbyStations(event.lat, event.lng, 30);
    const bodyLines = [
      `Магнитуда: ${event.magnitude}`,
      `Глубина: ${event.depth} км`,
      `Место: ${event.place}`,
      `Время: ${new Date(event.time).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`,
    ];

    if (nearbyStations.length > 0) {
      bodyLines.push(
        "",
        "⚠️ Близость к речным долинам — риск оползня:",
        ...nearbyStations.slice(0, 3).map(
          (s) => `  р. ${s.river} (${s.name}) — ${s.distanceKm} км`,
        ),
      );
    }

    try {
      let systemUser = await prisma.user.findFirst({
        where: { phone: "system_seismic_monitor" },
      });

      if (!systemUser) {
        systemUser = await prisma.user.create({
          data: {
            name: "Сейсмомониторинг",
            phone: "system_seismic_monitor",
            role: "admin",
            password: "",
          },
        });
      }

      const alert = await prisma.alert.create({
        data: {
          authorId: systemUser.id,
          urgency: event.magnitude >= 6.0 ? "critical" : "warning",
          title: `🔴 Землетрясение M${event.magnitude} — ${event.place}`,
          body: bodyLines.join("\n"),
          channels: ["pwa", "telegram", "sms", "meshtastic"],
        },
        include: { author: { select: { id: true, name: true, role: true } } },
      });

      emitAlertBroadcast(alert as unknown as Alert);
      alertedUsgsIds.set(event.usgsId, Date.now());
      log.warn(
        { magnitude: event.magnitude, place: event.place, nearbyStations: nearbyStations.length },
        "EARTHQUAKE ALERT triggered",
      );
    } catch (err) {
      // Don't mark as alerted — allow retry on next fetch cycle
      log.error({ err, usgsId: event.usgsId }, "Failed to create earthquake alert — will retry");
      return;
    }
  } else {
    // M4.5-4.9: mark as alerted after WebSocket emit (no DB alert needed)
    alertedUsgsIds.set(event.usgsId, Date.now());
  }
}

// ── Cleanup ─────────────────────────────────────────────────────────────

/** Delete earthquake records older than 30 days */
export async function cleanupOldEarthquakes(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const { count } = await prisma.earthquake.deleteMany({
    where: { time: { lt: cutoff } },
  });

  if (count > 0) {
    log.info({ deleted: count }, "Cleaned up old earthquake records");
  }
  return count;
}
