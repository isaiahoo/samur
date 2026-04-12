// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Import historical river level data from AllRivers.info CSV files.
 *
 * Usage: tsx src/importHistorical.ts [path-to-csv-directory]
 * Default directory: ../../Prediction data
 *
 * Idempotent — safe to run multiple times (uses skipDuplicates).
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync } from "fs";
import { join, basename } from "path";

const prisma = new PrismaClient();

// Maps CSV filename slug to (riverName, stationName) in DB
const SLUG_MAP: Record<string, { riverName: string; stationName: string }> = {
  "samur-usuhchaj": { riverName: "Самур", stationName: "Усухчай" },
  "samur-ahty": { riverName: "Самур", stationName: "Ахты" },
  "samur-luchek": { riverName: "Самур", stationName: "Лучек" },
  "sulak-miatly": { riverName: "Сулак", stationName: "Миатлы" },
  "sulak-yazykovka": { riverName: "Сулак", stationName: "Языковка" },
  "sulak-sulak": { riverName: "Сулак", stationName: "Сулак" },
};

const MIN_CM = -100;
const MAX_CM = 2000;
const BATCH_SIZE = 1000;

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

async function importCSV(csvPath: string, riverName: string, stationName: string): Promise<number> {
  const raw = readFileSync(csvPath, "utf-8");
  const lines = raw.trim().split("\n");

  // Skip header
  const dataLines = lines.slice(1);
  const rows: { id: string; riverName: string; stationName: string; date: Date; valueCm: number; source: string }[] = [];
  let filtered = 0;

  for (const line of dataLines) {
    const [dateStr, valueStr] = line.split(";");
    if (!dateStr || !valueStr) continue;

    const valueCm = parseFloat(valueStr.trim());
    if (isNaN(valueCm) || valueCm < MIN_CM || valueCm > MAX_CM) {
      filtered++;
      continue;
    }

    const date = new Date(dateStr.trim() + "T00:00:00.000Z");
    if (isNaN(date.getTime())) {
      filtered++;
      continue;
    }

    rows.push({
      id: `hist_${riverName}_${stationName}_${dateStr.trim()}`,
      riverName,
      stationName,
      date,
      valueCm,
      source: "allrivers.info",
    });
  }

  // Batch insert
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const result = await prisma.historicalRiverLevel.createMany({
      data: batch,
      skipDuplicates: true,
    });
    inserted += result.count;
  }

  if (filtered > 0) {
    console.log(`  ⚠ Filtered ${filtered} anomalous rows`);
  }
  console.log(`  ✓ ${inserted} rows inserted (${rows.length} valid in CSV)`);
  return rows.length;
}

async function computeStats(riverName: string, stationName: string): Promise<void> {
  // Fetch all raw readings for this station
  const readings = await prisma.historicalRiverLevel.findMany({
    where: { riverName, stationName },
    select: { date: true, valueCm: true },
    orderBy: { date: "asc" },
  });

  // Group by day-of-year
  const byDoy = new Map<number, number[]>();
  for (const r of readings) {
    const doy = getDayOfYear(new Date(r.date));
    if (!byDoy.has(doy)) byDoy.set(doy, []);
    byDoy.get(doy)!.push(r.valueCm);
  }

  // Compute stats per day-of-year
  const statsRows: {
    id: string;
    riverName: string;
    stationName: string;
    dayOfYear: number;
    avgCm: number;
    minCm: number;
    maxCm: number;
    p10Cm: number;
    p90Cm: number;
    sampleCount: number;
  }[] = [];

  for (const [doy, values] of byDoy) {
    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);
    statsRows.push({
      id: `stats_${riverName}_${stationName}_${doy}`,
      riverName,
      stationName,
      dayOfYear: doy,
      avgCm: Math.round((sum / sorted.length) * 10) / 10,
      minCm: sorted[0],
      maxCm: sorted[sorted.length - 1],
      p10Cm: Math.round(percentile(sorted, 0.10) * 10) / 10,
      p90Cm: Math.round(percentile(sorted, 0.90) * 10) / 10,
      sampleCount: sorted.length,
    });
  }

  // Upsert stats — delete old then insert
  await prisma.historicalRiverStats.deleteMany({ where: { riverName, stationName } });
  await prisma.historicalRiverStats.createMany({ data: statsRows });

  console.log(`  ✓ ${statsRows.length} day-of-year stats computed`);
}

async function main() {
  const csvDir = process.argv[2] || join(__dirname, "..", "..", "..", "Prediction data");
  console.log(`\nImporting historical river levels from: ${csvDir}\n`);

  const files = readdirSync(csvDir).filter((f) => f.endsWith(".csv"));
  if (files.length === 0) {
    console.error("No CSV files found in directory");
    process.exit(1);
  }

  const stations: { riverName: string; stationName: string }[] = [];

  for (const file of files) {
    const slug = basename(file, ".csv");
    const mapping = SLUG_MAP[slug];
    if (!mapping) {
      console.log(`⊘ Skipping ${file} — no station mapping for slug "${slug}"`);
      continue;
    }

    console.log(`\n📊 ${file} → ${mapping.riverName} / ${mapping.stationName}`);
    await importCSV(join(csvDir, file), mapping.riverName, mapping.stationName);
    stations.push(mapping);
  }

  // Compute stats for all imported stations
  console.log("\n\n📈 Computing day-of-year statistics...\n");
  for (const { riverName, stationName } of stations) {
    console.log(`${riverName} / ${stationName}:`);
    await computeStats(riverName, stationName);
  }

  // Summary
  const totalRaw = await prisma.historicalRiverLevel.count();
  const totalStats = await prisma.historicalRiverStats.count();
  console.log(`\n✅ Done. ${totalRaw} raw readings, ${totalStats} stat rows across ${stations.length} stations.\n`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
