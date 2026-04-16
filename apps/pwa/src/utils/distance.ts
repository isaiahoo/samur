// SPDX-License-Identifier: AGPL-3.0-only

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance between two lat/lng pairs, in metres. */
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Human-readable distance: "350 м", "2.3 км", "14 км". */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "";
  if (meters < 1000) return `${Math.round(meters / 10) * 10} м`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)} км`;
  return `${Math.round(meters / 1000)} км`;
}
