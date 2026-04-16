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
const EMSC_API = "https://www.seismicportal.eu/fdsnws/event/1/query";

/** Caucasus bounding box (covers Dagestan + surrounding seismic zone) */
const BBOX = {
  minlat: 41.0,
  maxlat: 44.5,
  minlon: 44.0,
  maxlon: 49.0,
} as const;

const MIN_MAGNITUDE = 2.5;
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

interface EmscFeature {
  id: string;
  properties: {
    mag: number | null;
    flynn_region: string | null;
    time: string; // ISO string
    depth: number | null;
    unid: string;
  };
  geometry: {
    coordinates: [number, number, number]; // [lng, lat, -depthKm]
  };
}

interface EmscResponse {
  type: "FeatureCollection";
  features: EmscFeature[];
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

// ── Settlements for readable place labels ───────────────────────────────

/**
 * Populated settlements in Dagestan + immediate border towns, used to turn
 * vague EMSC/USGS labels like "CAUCASUS REGION, RUSSIA" into a useful local
 * landmark ("10 км СЗ от Махачкалы"). nameGen is the Russian genitive form
 * needed by the "X км DIR от Y" construction.
 */
interface Settlement {
  name: string;
  nameGen: string;
  lat: number;
  lng: number;
}

const DAGESTAN_SETTLEMENTS: Settlement[] = [
  // Coast + major cities
  { name: "Махачкала", nameGen: "Махачкалы", lat: 42.9849, lng: 47.5047 },
  { name: "Каспийск", nameGen: "Каспийска", lat: 42.8950, lng: 47.6453 },
  { name: "Дербент", nameGen: "Дербента", lat: 42.0675, lng: 48.2886 },
  { name: "Хасавюрт", nameGen: "Хасавюрта", lat: 43.2483, lng: 46.5875 },
  { name: "Буйнакск", nameGen: "Буйнакска", lat: 42.8180, lng: 47.1189 },
  { name: "Избербаш", nameGen: "Избербаша", lat: 42.5593, lng: 47.8742 },
  { name: "Кизилюрт", nameGen: "Кизилюрта", lat: 43.2069, lng: 46.8704 },
  { name: "Кизляр", nameGen: "Кизляра", lat: 43.8463, lng: 46.7167 },
  { name: "Дагестанские Огни", nameGen: "Дагестанских Огней", lat: 42.1214, lng: 48.1928 },
  { name: "Южно-Сухокумск", nameGen: "Южно-Сухокумска", lat: 44.6575, lng: 45.6489 },
  // Plains
  { name: "Бабаюрт", nameGen: "Бабаюрта", lat: 43.5988, lng: 46.7842 },
  { name: "Тарумовка", nameGen: "Тарумовки", lat: 44.1208, lng: 46.7500 },
  { name: "Кочубей", nameGen: "Кочубея", lat: 44.4389, lng: 46.5519 },
  // Mountain districts
  { name: "Леваши", nameGen: "Левашей", lat: 42.4233, lng: 47.3181 },
  { name: "Акуша", nameGen: "Акуши", lat: 42.3219, lng: 47.3000 },
  { name: "Каякент", nameGen: "Каякента", lat: 42.4075, lng: 47.8633 },
  { name: "Новокаякент", nameGen: "Новокаякента", lat: 42.3353, lng: 47.9478 },
  { name: "Гуниб", nameGen: "Гуниба", lat: 42.3878, lng: 46.9578 },
  { name: "Гергебиль", nameGen: "Гергебиля", lat: 42.4992, lng: 47.0700 },
  { name: "Хунзах", nameGen: "Хунзаха", lat: 42.5411, lng: 46.7064 },
  { name: "Ботлих", nameGen: "Ботлиха", lat: 42.6692, lng: 46.2200 },
  { name: "Цунта", nameGen: "Цунты", lat: 42.1667, lng: 45.9167 },
  { name: "Тлярата", nameGen: "Тляраты", lat: 42.1200, lng: 46.3500 },
  { name: "Агвали", nameGen: "Агвали", lat: 42.5400, lng: 46.1200 },
  // South (Samur basin)
  { name: "Ахты", nameGen: "Ахтов", lat: 41.4636, lng: 47.7389 },
  { name: "Рутул", nameGen: "Рутула", lat: 41.5425, lng: 47.4189 },
  { name: "Магарамкент", nameGen: "Магарамкента", lat: 41.6111, lng: 48.1611 },
  { name: "Курах", nameGen: "Кураха", lat: 41.5833, lng: 47.8500 },
  { name: "Касумкент", nameGen: "Касумкента", lat: 41.7000, lng: 48.1667 },
  { name: "Белиджи", nameGen: "Белиджей", lat: 41.8667, lng: 48.3333 },
  { name: "Маджалис", nameGen: "Маджалиса", lat: 42.1333, lng: 47.8333 },
];

/** Compass bearing from `from` to `to`, rounded to 8-point cardinal. */
function compassBearing(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(fromLat), φ2 = toRad(toLat);
  const Δλ = toRad(toLng - fromLng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = toDeg(Math.atan2(y, x));
  const bearing = (θ + 360) % 360;
  const dirs = ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"];
  return dirs[Math.round(bearing / 45) % 8];
}

/** Find the nearest Dagestan settlement within the given radius (km). */
function nearestSettlement(lat: number, lng: number, radiusKm = 80): (Settlement & { distanceKm: number }) | null {
  let best: (Settlement & { distanceKm: number }) | null = null;
  for (const s of DAGESTAN_SETTLEMENTS) {
    const d = distanceKm(lat, lng, s.lat, s.lng);
    if (d > radiusKm) continue;
    if (!best || d < best.distanceKm) best = { ...s, distanceKm: Math.round(d) };
  }
  return best;
}

/**
 * Turn vague "CAUCASUS REGION, RUSSIA" labels into a precise Russian landmark
 * when a Dagestani settlement is nearby. Keeps the raw label when the event
 * is far from every known settlement (e.g. Azerbaijan, Georgia, open sea).
 */
function improvePlaceLabel(raw: string, lat: number, lng: number): string {
  const near = nearestSettlement(lat, lng, 80);
  if (!near) return raw;
  if (near.distanceKm <= 4) return near.name;
  const bearing = compassBearing(near.lat, near.lng, lat, lng);
  return `${near.distanceKm} км ${bearing} от ${near.nameGen}`;
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

// ── Source fetchers ─────────────────────────────────────────────────────

interface RawEvent {
  externalId: string;
  magnitude: number;
  depth: number;
  lat: number;
  lng: number;
  place: string;
  time: string;
  felt: number | null;
  mmi: number | null;
  source: string;
}

async function fetchFromUSGS(startDate: string): Promise<RawEvent[]> {
  const params = new URLSearchParams({
    format: "geojson",
    minlatitude: String(BBOX.minlat),
    maxlatitude: String(BBOX.maxlat),
    minlongitude: String(BBOX.minlon),
    maxlongitude: String(BBOX.maxlon),
    minmagnitude: String(MIN_MAGNITUDE),
    starttime: startDate,
    orderby: "time",
  });

  const data = await fetchJSON<UsgsResponse>(`${USGS_API}?${params}`, { service: "earthquake" });
  if (!data || !Array.isArray(data.features)) return [];

  const events: RawEvent[] = [];
  for (const feature of data.features) {
    const { properties: p, geometry: g } = feature;
    if (!p || !g || p.type !== "earthquake") continue;
    if (p.mag === null || p.mag < MIN_MAGNITUDE) continue;
    if (!Array.isArray(g.coordinates) || g.coordinates.length < 3) continue;

    const [lng, lat, depthKm] = g.coordinates;
    const roundedLat = Math.round(lat * 1000) / 1000;
    const roundedLng = Math.round(lng * 1000) / 1000;
    events.push({
      externalId: `usgs:${feature.id}`,
      magnitude: Math.round(p.mag * 10) / 10,
      depth: Math.round(depthKm * 10) / 10,
      lat: roundedLat,
      lng: roundedLng,
      place: improvePlaceLabel(p.place ?? "Неизвестное место", roundedLat, roundedLng),
      time: new Date(p.time).toISOString(),
      felt: p.felt ?? null,
      mmi: p.mmi !== null ? Math.round(p.mmi * 10) / 10 : null,
      source: "usgs",
    });
  }
  return events;
}

async function fetchFromEMSC(startDate: string): Promise<RawEvent[]> {
  const params = new URLSearchParams({
    format: "json",
    minlat: String(BBOX.minlat),
    maxlat: String(BBOX.maxlat),
    minlon: String(BBOX.minlon),
    maxlon: String(BBOX.maxlon),
    minmag: String(MIN_MAGNITUDE),
    start: startDate,
    limit: "100",
  });

  const data = await fetchJSON<EmscResponse>(`${EMSC_API}?${params}`, { service: "earthquake" });
  if (!data || !Array.isArray(data.features)) return [];

  const events: RawEvent[] = [];
  for (const feature of data.features) {
    const { properties: p, geometry: g } = feature;
    if (!p || !g) continue;
    if (p.mag === null || p.mag < MIN_MAGNITUDE) continue;
    if (!Array.isArray(g.coordinates) || g.coordinates.length < 3) continue;

    const [lng, lat, negDepth] = g.coordinates;
    const roundedLat = Math.round(lat * 1000) / 1000;
    const roundedLng = Math.round(lng * 1000) / 1000;
    events.push({
      externalId: `emsc:${p.unid || feature.id}`,
      magnitude: Math.round(p.mag * 10) / 10,
      depth: Math.round(Math.abs(negDepth) * 10) / 10,
      lat: roundedLat,
      lng: roundedLng,
      place: improvePlaceLabel(p.flynn_region ?? "Неизвестное место", roundedLat, roundedLng),
      time: new Date(p.time).toISOString(),
      felt: null,
      mmi: null,
      source: "emsc",
    });
  }
  return events;
}

// ── Main fetch ──────────────────────────────────────────────────────────

/**
 * Fetch recent earthquakes from EMSC (primary) + USGS (secondary),
 * store to DB, trigger alerts for significant events.
 */
export async function fetchEarthquakes(): Promise<EarthquakeEvent[]> {
  const startTime = new Date();
  startTime.setDate(startTime.getDate() - LOOKBACK_DAYS);
  const startDate = startTime.toISOString().split("T")[0];

  log.info("Fetching earthquakes from EMSC + USGS");

  // Fetch from both sources in parallel; don't let one failure block the other
  const [emscEvents, usgsEvents] = await Promise.all([
    fetchFromEMSC(startDate).catch((err) => {
      log.error({ err }, "EMSC fetch failed");
      return [] as RawEvent[];
    }),
    fetchFromUSGS(startDate).catch((err) => {
      log.error({ err }, "USGS fetch failed");
      return [] as RawEvent[];
    }),
  ]);

  // Merge: EMSC first (better Caucasus coverage), then USGS for any extras
  const rawEvents = [...emscEvents, ...usgsEvents];

  if (rawEvents.length === 0 && cachedEvents.length > 0) {
    log.warn("Both earthquake sources returned 0 events, keeping cache");
    return cachedEvents;
  }

  const events: EarthquakeEvent[] = [];

  pruneAlertedIds();

  for (const raw of rawEvents) {
    const event: EarthquakeEvent = {
      id: "",
      usgsId: raw.externalId,
      magnitude: raw.magnitude,
      depth: raw.depth,
      lat: raw.lat,
      lng: raw.lng,
      place: raw.place,
      time: raw.time,
      felt: raw.felt,
      mmi: raw.mmi,
      source: raw.source,
    };

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
          place: event.place,
        },
      });

      event.id = record.id;
      events.push(event);

      await checkAndTriggerEarthquakeAlert(event);
    } catch (err) {
      log.error({ err, usgsId: event.usgsId }, "Failed to upsert earthquake");
    }
  }

  cachedEvents = events;
  cachedAt = Date.now();

  const significant = events.filter((e) => e.magnitude >= ALERT_MAG_WEBSOCKET).length;
  log.info(
    { total: events.length, emsc: emscEvents.length, usgs: usgsEvents.length, significant },
    "Earthquake data updated",
  );

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
