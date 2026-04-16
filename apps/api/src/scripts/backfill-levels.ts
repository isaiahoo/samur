// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One-off backfill: apply the rating curve to every open-meteo row that
 * currently has `level_cm = NULL`. For the two stations where R² ≥ 0.4
 * (Самур/Ахты, Самур/Лучек) this populates the column from existing
 * discharge data, so the ML service no longer needs to fall through to
 * climatology for historical context the next time it runs.
 *
 * Run inside the api container:
 *   docker exec samur-api node apps/api/dist/scripts/backfill-levels.js
 */

import { prisma } from "@samur/db";
import { estimateLevelCm } from "../services/ratingCurve.js";

const SUPPORTED_STATIONS: Array<{ riverName: string; stationName: string }> = [
  { riverName: "Самур", stationName: "Ахты" },
  { riverName: "Самур", stationName: "Лучек" },
];

async function main() {
  let updated = 0;
  let skipped = 0;

  for (const station of SUPPORTED_STATIONS) {
    const rows = await prisma.riverLevel.findMany({
      where: {
        riverName: station.riverName,
        stationName: station.stationName,
        deletedAt: null,
        dischargeCubicM: { gt: 0 },
        levelCm: null,
      },
      orderBy: { measuredAt: "asc" },
      select: {
        id: true,
        measuredAt: true,
        dischargeCubicM: true,
      },
    });

    // Build a full series sorted by date so we can compute rolling means.
    // Include rows that already have levelCm for context (they contribute
    // to rolling windows but are not themselves updated).
    const contextRows = await prisma.riverLevel.findMany({
      where: {
        riverName: station.riverName,
        stationName: station.stationName,
        deletedAt: null,
        dischargeCubicM: { gt: 0 },
      },
      orderBy: { measuredAt: "asc" },
      select: {
        id: true,
        measuredAt: true,
        dischargeCubicM: true,
      },
    });

    const series = contextRows.map((r) => ({
      id: r.id,
      date: r.measuredAt,
      discharge: r.dischargeCubicM!,
    }));

    const rowsById = new Set(rows.map((r) => r.id));
    console.log(
      `[${station.riverName}/${station.stationName}] ${series.length} discharge rows, ${rows.length} without level_cm`,
    );

    for (let i = 0; i < series.length; i++) {
      const entry = series[i];
      if (!rowsById.has(entry.id)) continue;

      // Rolling means over the 3 and 7 most recent entries INCLUDING this one
      const window3 = series.slice(Math.max(0, i - 2), i + 1).map((r) => r.discharge);
      const window7 = series.slice(Math.max(0, i - 6), i + 1).map((r) => r.discharge);
      const mean3 = window3.reduce((a, b) => a + b, 0) / window3.length;
      const mean7 = window7.reduce((a, b) => a + b, 0) / window7.length;

      const est = estimateLevelCm(
        station.riverName,
        station.stationName,
        entry.discharge,
        mean3,
        mean7,
        entry.date,
      );

      if (!est) {
        skipped++;
        continue;
      }

      await prisma.riverLevel.update({
        where: { id: entry.id },
        data: { levelCm: est.levelCm },
      });
      updated++;
    }
  }

  console.log(`Backfill complete — updated ${updated} rows, skipped ${skipped}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
