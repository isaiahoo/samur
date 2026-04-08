// SPDX-License-Identifier: AGPL-3.0-only
const EARTH_RADIUS_KM = 6371;

/**
 * Haversine distance between two WGS84 points, in kilometers.
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatCoordinates(lat: number, lng: number): string {
  const latDir = lat >= 0 ? "с.ш." : "ю.ш.";
  const lngDir = lng >= 0 ? "в.д." : "з.д.";
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

/**
 * Format a date/timestamp as relative time in Russian.
 * E.g. "5 минут назад", "2 часа назад", "вчера"
 */
export function formatRelativeTime(date: string | Date): string {
  const now = Date.now();
  const then = typeof date === "string" ? new Date(date).getTime() : date.getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 0) {
    return "только что";
  }
  if (diffSec < 30) {
    return "только что";
  }
  if (diffSec < MINUTE) {
    return `${diffSec} сек. назад`;
  }
  if (diffSec < HOUR) {
    const m = Math.floor(diffSec / MINUTE);
    return `${m} ${pluralizeRu(m, "минуту", "минуты", "минут")} назад`;
  }
  if (diffSec < DAY) {
    const h = Math.floor(diffSec / HOUR);
    return `${h} ${pluralizeRu(h, "час", "часа", "часов")} назад`;
  }
  if (diffSec < 2 * DAY) {
    return "вчера";
  }
  const d = Math.floor(diffSec / DAY);
  if (d < 30) {
    return `${d} ${pluralizeRu(d, "день", "дня", "дней")} назад`;
  }
  // Fall back to absolute date
  const dt = new Date(then);
  return dt.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Russian pluralization for numeric phrases.
 * pluralizeRu(1, "минуту", "минуты", "минут") → "минуту"
 * pluralizeRu(5, "минуту", "минуты", "минут") → "минут"
 */
export function pluralizeRu(
  n: number,
  one: string,
  few: string,
  many: string
): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;

  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function formatDistance(km: number): string {
  if (km < 1) {
    return `${Math.round(km * 1000)} м`;
  }
  return `${km.toFixed(1)} км`;
}

export function isInDagestan(lat: number, lng: number): boolean {
  return lat >= 41.1 && lat <= 44.3 && lng >= 45.0 && lng <= 48.6;
}

export function isInBounds(
  lat: number,
  lng: number,
  bounds: { north: number; south: number; east: number; west: number }
): boolean {
  return (
    lat >= bounds.south &&
    lat <= bounds.north &&
    lng >= bounds.west &&
    lng <= bounds.east
  );
}
