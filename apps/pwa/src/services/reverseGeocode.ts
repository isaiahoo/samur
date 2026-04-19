// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reverse-geocoding via Nominatim, shared across surfaces that need
 * "human-readable place name for these coords" — ReportForm picks the
 * user's auto-detected location name, HelpDetailSheet falls back to
 * this when the request has no stored address.
 *
 * Nominatim's usage policy asks for:
 *   - An identifiable User-Agent (we send "Kunak-PWA/1.0")
 *   - No more than 1 req/s (we rate-limit via a per-key promise)
 *   - Caching of responses (in-memory map, keyed on 4-decimal coords)
 *
 * In-memory only — reload wipes the cache. Good enough for a session
 * where the volunteer pans around a dozen markers; anything longer-
 * lived would need IndexedDB but a stale label outranks a slow one.
 */

const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

/** 4 decimal places is ~11 m — close enough that two clicks on the
 * same marker share a cache entry, but still differentiated for
 * markers only a few blocks apart. */
function keyFor(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

async function fetchOnce(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ru&zoom=14`,
      { headers: { "User-Agent": "Kunak-PWA/1.0" } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { address?: Record<string, string>; display_name?: string };
    const a = data.address;
    if (!a) return null;
    // Prefer fine-grained → coarse: village > town > city > suburb > district > county
    const locality =
      a.village || a.town || a.city || a.hamlet || a.suburb ||
      a.city_district || a.county || null;
    const region = a.state_district || a.state || null;
    const bits: string[] = [];
    if (locality) bits.push(locality);
    if (region && region !== locality) bits.push(region);
    if (bits.length === 0) {
      // Last-ditch — pick the first two comma-separated tokens from
      // display_name so we don't just return null on sparse records.
      return data.display_name?.split(",").slice(0, 2).join(",").trim() ?? null;
    }
    return bits.join(", ");
  } catch {
    return null;
  }
}

/** Returns a place name like "Ахты, Ахтынский р-н" or null if the
 * service is unreachable. Repeated calls for the same coordinates
 * return the cached value instantly; concurrent calls share the
 * in-flight promise rather than hammering Nominatim. */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = keyFor(lat, lng);
  if (cache.has(key)) return cache.get(key) ?? null;
  const existing = inflight.get(key);
  if (existing) return existing;

  const p = fetchOnce(lat, lng).then((result) => {
    cache.set(key, result);
    inflight.delete(key);
    return result;
  });
  inflight.set(key, p);
  return p;
}
