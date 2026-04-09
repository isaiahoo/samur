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
    openMeteoLat: 42.925, // calibrated 2026-04-08: 226 m³/s (upstream of Chirkey dam)
    openMeteoLng: 46.875,
    meanDischarge: 200,
    dangerDischarge: 800,
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
    openMeteoLat: 43.525, // calibrated 2026-04-08: 52 m³/s (delta, low GloFAS resolution)
    openMeteoLng: 47.075,
    meanDischarge: 50,
    dangerDischarge: 200,
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
    openMeteoLat: 41.425, // calibrated 2026-04-08: 61 m³/s
    openMeteoLng: 47.825,
    meanDischarge: 50,
    dangerDischarge: 200,
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
    openMeteoLat: 41.525, // calibrated 2026-04-08: 130 m³/s (lower Самур)
    openMeteoLng: 48.175,
    meanDischarge: 100,
    dangerDischarge: 400,
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
    openMeteoLat: 43.375, // calibrated 2026-04-08: 396 m³/s
    openMeteoLng: 45.775,
    meanDischarge: 300,
    dangerDischarge: 1500,
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
    meanDischarge: 850, // GloFAS grid captures full lower Терек basin (winter ~400, spring ~1400)
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
    openMeteoLat: 43.525, // calibrated 2026-04-08: 1412 m³/s
    openMeteoLng: 46.375,
    meanDischarge: 850, // GloFAS grid captures full lower Терек basin (winter ~400, spring ~1400)
    dangerDischarge: 2000,
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
    openMeteoLat: 42.625, // calibrated 2026-04-08: 126 m³/s
    openMeteoLng: 46.875,
    meanDischarge: 100,
    dangerDischarge: 500,
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
    openMeteoLat: 42.775, // calibrated 2026-04-08: 83 m³/s
    openMeteoLng: 46.675,
    meanDischarge: 80,
    dangerDischarge: 400,
  },

  // ── Derbent district rivers ────────────────────────────────────────────
  {
    riverName: "Уллучай",
    stationName: "Каякент",
    lat: 42.35,
    lng: 48.05,
    dangerLevelCm: 250,
    allriversSlug: null,
    urovenSlug: null,
    roshydrometId: null,
    openMeteoLat: 42.325, // calibrated 2026-04-09: 155 m³/s
    openMeteoLng: 48.125,
    meanDischarge: 41,
    dangerDischarge: 200,
  },
  {
    riverName: "Рубас",
    stationName: "Дербент",
    lat: 42.06,
    lng: 48.29,
    dangerLevelCm: 200,
    allriversSlug: null,
    urovenSlug: null,
    roshydrometId: null,
    openMeteoLat: 41.975, // calibrated 2026-04-09: 113 m³/s
    openMeteoLng: 48.375,
    meanDischarge: 24,
    dangerDischarge: 100,
  },
  {
    riverName: "Гюльгеричай",
    stationName: "Магарамкент",
    lat: 41.60,
    lng: 48.16,
    dangerLevelCm: 200,
    allriversSlug: null,
    urovenSlug: null,
    roshydrometId: null,
    openMeteoLat: 41.875, // calibrated 2026-04-09: 71 m³/s
    openMeteoLng: 48.175,
    meanDischarge: 19,
    dangerDischarge: 80,
  },
  {
    riverName: "Самур",
    stationName: "Устье (дельта)",
    lat: 41.80,
    lng: 48.55,
    dangerLevelCm: 300,
    allriversSlug: null,
    urovenSlug: null,
    roshydrometId: null,
    openMeteoLat: 41.775, // calibrated 2026-04-09: 190 m³/s (delta/lower course)
    openMeteoLng: 48.325,
    meanDischarge: 196,
    dangerDischarge: 500,
  },

  // ── Аксай (Aksay — tributary of Терек) ────────────────────────────────
  {
    riverName: "Аксай",
    stationName: "Хасавюрт",
    lat: 43.25,
    lng: 46.58,
    dangerLevelCm: 350,
    allriversSlug: null,
    urovenSlug: null,
    roshydrometId: null,
    openMeteoLat: 43.275,
    openMeteoLng: 46.575,
    meanDischarge: 25,
    dangerDischarge: 120,
  },

  // ── Шура-Озень (Shura-Ozen) ──────────────────────────────────────────
  {
    riverName: "Шура-Озень",
    stationName: "Буйнакск",
    lat: 42.80,
    lng: 47.15,
    dangerLevelCm: 250,
    allriversSlug: null,
    urovenSlug: null,
    roshydrometId: null,
    openMeteoLat: 42.825,
    openMeteoLng: 47.175,
    meanDischarge: 15,
    dangerDischarge: 80,
  },

  // ── Казикумухское Койсу (feeds into Сулак system) ─────────────────────
  {
    riverName: "Казикумухское Койсу",
    stationName: "Кули",
    lat: 42.18,
    lng: 47.05,
    dangerLevelCm: 280,
    allriversSlug: null,
    urovenSlug: null,
    roshydrometId: null,
    openMeteoLat: 42.175,
    openMeteoLng: 47.075,
    meanDischarge: 30,
    dangerDischarge: 150,
  },

  // ── Кара-Койсу (feeds into Аварское Койсу → Сулак) ───────────────────
  {
    riverName: "Кара-Койсу",
    stationName: "Гергебиль",
    lat: 42.38,
    lng: 47.10,
    dangerLevelCm: 280,
    allriversSlug: null,
    urovenSlug: null,
    roshydrometId: null,
    openMeteoLat: 42.375,
    openMeteoLng: 47.125,
    meanDischarge: 40,
    dangerDischarge: 200,
  },

  // ── Акташ (coastal river, Каякент district) ──────────────────────────
  {
    riverName: "Акташ",
    stationName: "Манас",
    lat: 42.63,
    lng: 47.60,
    dangerLevelCm: 200,
    allriversSlug: null,
    urovenSlug: null,
    roshydrometId: null,
    openMeteoLat: 42.625,
    openMeteoLng: 47.625,
    meanDischarge: 10,
    dangerDischarge: 60,
  },

  // ── Манас-Озень (coastal river near Каспийск) ────────────────────────
  {
    riverName: "Манас-Озень",
    stationName: "Каспийск",
    lat: 42.85,
    lng: 47.65,
    dangerLevelCm: 200,
    allriversSlug: null,
    urovenSlug: null,
    roshydrometId: null,
    openMeteoLat: 42.875,
    openMeteoLng: 47.675,
    meanDischarge: 8,
    dangerDischarge: 50,
  },
];

/** Get a station key for deduplication (riverName + stationName) */
export function stationKey(riverName: string, stationName: string): string {
  return `${riverName}::${stationName}`;
}
