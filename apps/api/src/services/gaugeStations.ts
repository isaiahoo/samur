// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Registry of known hydrological gauge stations in Dagestan.
 * Sources: allrivers.info, urovenvody.ru
 *
 * Coordinates are approximate (from gauge metadata pages).
 * Danger levels are estimated from historical max values —
 * coordinators can override per-station via the admin panel.
 */

export interface GaugeStation {
  /** Human-readable river name (Russian) */
  riverName: string;
  /** Human-readable station name (Russian) */
  stationName: string;
  /** Latitude */
  lat: number;
  /** Longitude */
  lng: number;
  /** Estimated danger level in cm (from historical maximums) */
  dangerLevelCm: number;
  /** allrivers.info slug (e.g., "sulak-yazykovka") */
  allriversSlug: string | null;
  /** urovenvody.ru slug (e.g., "usuhchaj") */
  urovenSlug: string | null;
  /** Roshydromet station ID (for future API integration) */
  roshydrometId: string | null;
  /** Calibrated Open-Meteo latitude (5km grid-aligned) */
  openMeteoLat: number | null;
  /** Calibrated Open-Meteo longitude (5km grid-aligned) */
  openMeteoLng: number | null;
  /** Historical mean annual discharge in m³/s (fallback for % calculation) */
  meanDischarge: number | null;
  /** Approximate danger discharge in m³/s (fallback threshold) */
  dangerDischarge: number | null;
}

export const DAGESTAN_GAUGES: GaugeStation[] = [
  // ── Сулак (Sulak) ──────────────────────────────────────────────────────
  {
    riverName: "Сулак",
    stationName: "Миатлы",
    lat: 42.88,
    lng: 47.01,
    dangerLevelCm: 350,
    allriversSlug: "sulak-miatly",
    urovenSlug: null,
    roshydrometId: null,
    openMeteoLat: null, // needs calibration
    openMeteoLng: null,
    meanDischarge: null,
    dangerDischarge: null,
  },
  {
    riverName: "Сулак",
    stationName: "Языковка",
    lat: 43.35,
    lng: 46.98,
    dangerLevelCm: 400,
    allriversSlug: "sulak-yazykovka",
    urovenSlug: null,
    roshydrometId: null,
    openMeteoLat: 43.375, // calibrated 2026-04-08
    openMeteoLng: 46.975,
    meanDischarge: 150,
    dangerDischarge: 500,
  },
  {
    riverName: "Сулак",
    stationName: "Сулак",
    lat: 43.46,
    lng: 47.07,
    dangerLevelCm: 350,
    allriversSlug: "sulak-sulak",
    urovenSlug: null,
    roshydrometId: null,
    openMeteoLat: null, // needs calibration
    openMeteoLng: null,
    meanDischarge: null,
    dangerDischarge: null,
  },

  // ── Самур (Samur) ──────────────────────────────────────────────────────
  {
    riverName: "Самур",
    stationName: "Усухчай",
    lat: 41.43,
    lng: 47.91,
    dangerLevelCm: 300,
    allriversSlug: "samur-usuhchaj",
    urovenSlug: "usuhchaj",
    roshydrometId: "84344",
    openMeteoLat: 41.425, // calibrated 2026-04-08
    openMeteoLng: 47.925,
    meanDischarge: 40,
    dangerDischarge: 150,
  },
  {
    riverName: "Самур",
    stationName: "Ахты",
    lat: 41.46,
    lng: 47.74,
    dangerLevelCm: 350,
    allriversSlug: "samur-ahty",
    urovenSlug: null,
    roshydrometId: null,
    openMeteoLat: null, // needs calibration
    openMeteoLng: null,
    meanDischarge: null,
    dangerDischarge: null,
  },
  {
    riverName: "Самур",
    stationName: "Лучек",
    lat: 41.51,
    lng: 48.21,
    dangerLevelCm: 300,
    allriversSlug: "samur-luchek",
    urovenSlug: null,
    roshydrometId: null,
    openMeteoLat: null, // needs calibration
    openMeteoLng: null,
    meanDischarge: null,
    dangerDischarge: null,
  },

  // ── Терек (Terek) — Dagestan section ───────────────────────────────────
  {
    riverName: "Терек",
    stationName: "Хангаш-Юрт",
    lat: 43.35,
    lng: 45.70,
    dangerLevelCm: 500,
    allriversSlug: "terek-hangash-yurt",
    urovenSlug: null,
    roshydrometId: null,
    openMeteoLat: null, // needs calibration
    openMeteoLng: null,
    meanDischarge: null,
    dangerDischarge: null,
  },
  {
    riverName: "Терек",
    stationName: "Аликазган",
    lat: 43.52,
    lng: 46.34,
    dangerLevelCm: 450,
    allriversSlug: "tepek-ruk-alikazgan",
    urovenSlug: "alikazgan",
    roshydrometId: "84822",
    openMeteoLat: 43.475, // calibrated 2026-04-08
    openMeteoLng: 46.325,
    meanDischarge: 300,
    dangerDischarge: 2000,
  },
  {
    riverName: "Терек",
    stationName: "Каргалинский гидроузел",
    lat: 43.56,
    lng: 46.50,
    dangerLevelCm: 450,
    allriversSlug: "terek-kargalinskiy-gidrouzel",
    urovenSlug: "kargalinskoe",
    roshydrometId: "84803",
    openMeteoLat: null, // needs calibration
    openMeteoLng: null,
    meanDischarge: null,
    dangerDischarge: null,
  },

  // ── Tributaries (Койсу rivers → form Сулак) ────────────────────────────
  {
    riverName: "Аварское Койсу",
    stationName: "Красный Мост",
    lat: 42.55,
    lng: 46.95,
    dangerLevelCm: 300,
    allriversSlug: null,
    urovenSlug: "krasnyj-most",
    roshydrometId: "84453",
    openMeteoLat: null, // needs calibration
    openMeteoLng: null,
    meanDischarge: null,
    dangerDischarge: null,
  },
  {
    riverName: "Андийское Койсу",
    stationName: "Чиркота",
    lat: 42.78,
    lng: 46.70,
    dangerLevelCm: 280,
    allriversSlug: null,
    urovenSlug: "chirkota",
    roshydrometId: "84302",
    openMeteoLat: null, // needs calibration
    openMeteoLng: null,
    meanDischarge: null,
    dangerDischarge: null,
  },
];

/** Get a station key for deduplication (riverName + stationName) */
export function stationKey(riverName: string, stationName: string): string {
  return `${riverName}::${stationName}`;
}
