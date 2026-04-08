#!/usr/bin/env npx tsx
// SPDX-License-Identifier: AGPL-3.0-only
//
// One-time calibration script for Open-Meteo Flood API coordinates.
//
// The Open-Meteo Flood API (GloFAS) uses a 5km grid. A gauge station's
// physical coordinates may land on a dry cell. This script tests a grid
// of nearby points and finds the cell with the highest median discharge
// (i.e., the main river channel).
//
// Usage:
//   npx tsx scripts/calibrate-open-meteo.ts
//
// Output: recommended openMeteoLat/openMeteoLng for each uncalibrated station.

const FLOOD_API = "https://flood-api.open-meteo.com/v1/flood";

interface Station {
  riverName: string;
  stationName: string;
  lat: number;
  lng: number;
  openMeteoLat: number | null;
  openMeteoLng: number | null;
}

// Import from gaugeStations (or inline for standalone use)
const STATIONS: Station[] = [
  { riverName: "Сулак", stationName: "Миатлы", lat: 42.88, lng: 47.01, openMeteoLat: null, openMeteoLng: null },
  { riverName: "Сулак", stationName: "Языковка", lat: 43.35, lng: 46.98, openMeteoLat: 43.375, openMeteoLng: 46.975 },
  { riverName: "Сулак", stationName: "Сулак", lat: 43.46, lng: 47.07, openMeteoLat: null, openMeteoLng: null },
  { riverName: "Самур", stationName: "Усухчай", lat: 41.43, lng: 47.91, openMeteoLat: 41.425, openMeteoLng: 47.925 },
  { riverName: "Самур", stationName: "Ахты", lat: 41.46, lng: 47.74, openMeteoLat: null, openMeteoLng: null },
  { riverName: "Самур", stationName: "Лучек", lat: 41.51, lng: 48.21, openMeteoLat: null, openMeteoLng: null },
  { riverName: "Терек", stationName: "Хангаш-Юрт", lat: 43.35, lng: 45.70, openMeteoLat: null, openMeteoLng: null },
  { riverName: "Терек", stationName: "Аликазган", lat: 43.52, lng: 46.34, openMeteoLat: 43.475, openMeteoLng: 46.325 },
  { riverName: "Терек", stationName: "Каргалинский гидроузел", lat: 43.56, lng: 46.50, openMeteoLat: null, openMeteoLng: null },
  { riverName: "Аварское Койсу", stationName: "Красный Мост", lat: 42.55, lng: 46.95, openMeteoLat: null, openMeteoLng: null },
  { riverName: "Андийское Койсу", stationName: "Чиркота", lat: 42.78, lng: 46.70, openMeteoLat: null, openMeteoLng: null },
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function generateGrid(centerLat: number, centerLng: number, step = 0.025, range = 0.1): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let dlat = -range; dlat <= range + 0.001; dlat += step) {
    for (let dlng = -range; dlng <= range + 0.001; dlng += step) {
      points.push([
        Math.round((centerLat + dlat) * 1000) / 1000,
        Math.round((centerLng + dlng) * 1000) / 1000,
      ]);
    }
  }
  return points;
}

async function calibrateStation(station: Station): Promise<void> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`${station.riverName} — ${station.stationName} (${station.lat}, ${station.lng})`);

  if (station.openMeteoLat !== null) {
    console.log(`  Already calibrated: (${station.openMeteoLat}, ${station.openMeteoLng})`);
    return;
  }

  const grid = generateGrid(station.lat, station.lng);
  console.log(`  Testing ${grid.length} grid points...`);

  // Batch in groups of 10 (comma-separated lat/lng in one API call)
  const BATCH = 10;
  const results: Array<{ lat: number; lng: number; median: number }> = [];

  for (let i = 0; i < grid.length; i += BATCH) {
    const batch = grid.slice(i, i + BATCH);
    const lats = batch.map(([lat]) => lat).join(",");
    const lngs = batch.map(([, lng]) => lng).join(",");
    const url = `${FLOOD_API}?latitude=${lats}&longitude=${lngs}&daily=river_discharge&past_days=30`;

    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "Samur-Calibrator/1.0" },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) { console.log(`  Batch ${i / BATCH + 1} failed: ${res.status}`); continue; }

      const raw = await res.json() as unknown;
      const responses = Array.isArray(raw) ? raw : [raw];

      for (let j = 0; j < batch.length && j < responses.length; j++) {
        const r = responses[j] as { daily?: { river_discharge?: (number | null)[] } };
        const values = (r.daily?.river_discharge ?? []).filter((v): v is number => v !== null && v > 0);
        if (values.length === 0) { results.push({ lat: batch[j][0], lng: batch[j][1], median: 0 }); continue; }
        values.sort((a, b) => a - b);
        const median = values[Math.floor(values.length / 2)];
        results.push({ lat: batch[j][0], lng: batch[j][1], median });
      }
    } catch (err) {
      console.log(`  Batch ${i / BATCH + 1} error: ${err}`);
    }

    await sleep(500); // Rate limiting
  }

  // Sort by median discharge descending
  results.sort((a, b) => b.median - a.median);
  const top5 = results.slice(0, 5);

  console.log(`  Top 5 candidates:`);
  for (const r of top5) {
    console.log(`    (${r.lat}, ${r.lng}) → median ${r.median.toFixed(1)} m³/s`);
  }

  if (top5[0] && top5[0].median > 0) {
    console.log(`\n  ✅ RECOMMENDED: openMeteoLat: ${top5[0].lat}, openMeteoLng: ${top5[0].lng}`);
    console.log(`     Median discharge: ${top5[0].median.toFixed(1)} m³/s`);
  } else {
    console.log(`\n  ❌ No discharge found in grid — station may be too small for GloFAS resolution`);
  }
}

async function main() {
  console.log("Open-Meteo Flood API Coordinate Calibration");
  console.log("============================================\n");
  console.log("This script tests a grid of ±0.1° around each station");
  console.log("to find the 5km cell with the highest median discharge.\n");

  const uncalibrated = STATIONS.filter((s) => s.openMeteoLat === null);
  console.log(`Uncalibrated stations: ${uncalibrated.length} of ${STATIONS.length}`);

  for (const station of uncalibrated) {
    await calibrateStation(station);
    await sleep(1000);
  }

  console.log("\n\nDone! Update gaugeStations.ts with the recommended coordinates.");
}

main().catch(console.error);
