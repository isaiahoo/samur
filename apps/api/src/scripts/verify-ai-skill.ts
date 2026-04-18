// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Independently recompute RMSE for the Самур/Ахты and Самур/Лучек
 * stations and compare against what GET /river-levels/ai-skill
 * returns. Sanity-check for the forecast-accuracy dashboard.
 *
 * Per the memory, this check is scheduled for ≥ 2026-04-27 — run once
 * enough evaluated forecasts have accumulated that the numbers are
 * meaningful (the /ai-skill endpoint already defaults to a 30-day
 * window, so 2026-04-27 gives us a month of snapshots starting from
 * late March).
 *
 * Independence: the endpoint's RMSE math and this script's math read
 * the same two tables (forecast_snapshots, river_levels) so they
 * can't disagree due to a data-fetch bug. A mismatch would mean the
 * aggregation logic drifted. Both compute RMSE = sqrt(mean((pred-obs)²))
 * over the same paired-samples population.
 *
 * Run inside the api container:
 *   docker exec samur-api node apps/api/dist/scripts/verify-ai-skill.js
 * Or against a remote API:
 *   API_URL=https://mykunak.ru node apps/api/dist/scripts/verify-ai-skill.js
 */

import { prisma } from "@samur/db";

const STATIONS: Array<{ riverName: string; stationName: string }> = [
  { riverName: "Самур", stationName: "Ахты" },
  { riverName: "Самур", stationName: "Лучек" },
];

const API_URL = process.env.API_URL ?? "http://localhost:3000";
const DAYS = parseInt(process.env.DAYS ?? "30", 10);

interface EndpointRow {
  riverName: string;
  stationName: string;
  horizonDays: number;
  n: number;
  nse: number | null;
  rmseCm: number;
  biasCm: number;
  climatologyShare: number;
}

interface LocalRow {
  riverName: string;
  stationName: string;
  horizonDays: number;
  n: number;
  rmseCm: number;
}

async function computeLocal(): Promise<LocalRow[]> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const windowStart = new Date(today.getTime() - DAYS * 86_400_000);

  const snapshots = await prisma.forecastSnapshot.findMany({
    where: {
      targetDate: { gte: windowStart, lt: today },
      OR: STATIONS.map((s) => ({ riverName: s.riverName, stationName: s.stationName })),
    },
    select: {
      riverName: true,
      stationName: true,
      horizonDays: true,
      targetDate: true,
      predictedCm: true,
    },
  });

  const observedRows = await prisma.riverLevel.findMany({
    where: {
      deletedAt: null,
      isForecast: false,
      measuredAt: { gte: windowStart, lt: today },
      levelCm: { not: null },
      OR: STATIONS.map((s) => ({ riverName: s.riverName, stationName: s.stationName })),
    },
    select: {
      riverName: true,
      stationName: true,
      measuredAt: true,
      levelCm: true,
    },
  });

  const observedMap = new Map<string, number>();
  for (const r of observedRows) {
    if (r.levelCm === null) continue;
    const day = r.measuredAt.toISOString().slice(0, 10);
    const key = `${r.riverName}::${r.stationName}::${day}`;
    if (!observedMap.has(key)) observedMap.set(key, r.levelCm);
  }

  const groups = new Map<string, { sumSqErr: number; n: number; riverName: string; stationName: string; horizonDays: number }>();
  for (const s of snapshots) {
    const day = s.targetDate.toISOString().slice(0, 10);
    const obs = observedMap.get(`${s.riverName}::${s.stationName}::${day}`);
    if (obs === undefined) continue;
    const key = `${s.riverName}::${s.stationName}::${s.horizonDays}`;
    let g = groups.get(key);
    if (!g) {
      g = { sumSqErr: 0, n: 0, riverName: s.riverName, stationName: s.stationName, horizonDays: s.horizonDays };
      groups.set(key, g);
    }
    g.sumSqErr += (s.predictedCm - obs) ** 2;
    g.n += 1;
  }

  return Array.from(groups.values()).map((g) => ({
    riverName: g.riverName,
    stationName: g.stationName,
    horizonDays: g.horizonDays,
    n: g.n,
    rmseCm: Math.round(Math.sqrt(g.sumSqErr / g.n) * 10) / 10,
  }));
}

async function fetchEndpoint(): Promise<EndpointRow[]> {
  const res = await fetch(`${API_URL}/api/v1/river-levels/ai-skill?days=${DAYS}`);
  if (!res.ok) {
    throw new Error(`GET /ai-skill → ${res.status}`);
  }
  const body = (await res.json()) as { success: boolean; data: EndpointRow[] };
  if (!body.success) throw new Error("endpoint returned success=false");
  return body.data.filter((d) =>
    STATIONS.some((s) => s.riverName === d.riverName && s.stationName === d.stationName),
  );
}

function fmtStation(r: { riverName: string; stationName: string; horizonDays: number }): string {
  return `${r.riverName}/${r.stationName} h=${r.horizonDays}d`;
}

async function main() {
  process.stderr.write(`window: ${DAYS} days ending today (UTC)\napi:    ${API_URL}\n\n`);

  const [local, endpoint] = await Promise.all([computeLocal(), fetchEndpoint()]);

  const byKey = (r: { riverName: string; stationName: string; horizonDays: number }) =>
    `${r.riverName}::${r.stationName}::${r.horizonDays}`;
  const localMap = new Map(local.map((r) => [byKey(r), r]));
  const endpointMap = new Map(endpoint.map((r) => [byKey(r), r]));
  const keys = new Set([...localMap.keys(), ...endpointMap.keys()]);

  let anyMismatch = false;
  process.stdout.write(
    `${"station".padEnd(30)} ${"n".padStart(5)}  ${"local RMSE".padStart(12)}  ${"api RMSE".padStart(12)}  verdict\n`,
  );
  process.stdout.write(`${"-".repeat(80)}\n`);

  for (const key of Array.from(keys).sort()) {
    const l = localMap.get(key);
    const e = endpointMap.get(key);
    if (!l || !e) {
      anyMismatch = true;
      process.stdout.write(
        `${(l ?? e!)}`.padEnd(30) +
        ` ONE_SIDE_ONLY — local=${l ? "yes" : "no"}, api=${e ? "yes" : "no"}\n`,
      );
      continue;
    }
    // Both rounded to 0.1 cm already; a 0.1 delta is noise.
    const delta = Math.abs(l.rmseCm - e.rmseCm);
    const ok = delta <= 0.1;
    if (!ok) anyMismatch = true;
    process.stdout.write(
      `${fmtStation(l).padEnd(30)} ${String(l.n).padStart(5)}  ${String(l.rmseCm).padStart(10)} cm  ${String(e.rmseCm).padStart(10)} cm  ${ok ? "OK" : `MISMATCH Δ=${delta.toFixed(2)}`}\n`,
    );
  }

  process.stdout.write(`\n${anyMismatch ? "FAIL — see mismatches above" : "PASS — local and endpoint agree within rounding"}\n`);
  await prisma.$disconnect();
  process.exit(anyMismatch ? 1 : 0);
}

main().catch(async (err) => {
  process.stderr.write(`verify-ai-skill failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  await prisma.$disconnect();
  process.exit(2);
});
