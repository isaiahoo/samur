// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Ships a DB Alert when an AI forecast's upper bound crosses a
 * station's danger threshold. Deduplicates one-per-station-per-day so
 * the hourly ML cycle doesn't spam the feed, but will escalate
 * warning → critical within the same day if the forecast deteriorates.
 *
 * Only high/medium-skill stations with live-observations source qualify.
 * Seasonal-source predictions cannot legitimately justify an alert.
 */

import { prisma } from "@samur/db";
import type { Alert } from "@samur/shared";
import { logger } from "../lib/logger.js";
import { emitAlertBroadcast } from "../lib/emitter.js";
import { getAllAiStationMeta } from "./mlClient.js";

const log = logger.child({ service: "ai-alert-generator" });

const WARNING_THRESHOLD = 0.75;  // upper bound ≥ 75% of danger → warning
const ALERT_TTL_MS = 24 * 60 * 60 * 1000;
const SYSTEM_USER_PHONE = "system_ai_forecast";

async function ensureSystemUser(): Promise<string> {
  let u = await prisma.user.findFirst({ where: { phone: SYSTEM_USER_PHONE } });
  if (!u) {
    u = await prisma.user.create({
      data: {
        name: "Кунак AI",
        phone: SYSTEM_USER_PHONE,
        role: "admin",
        password: "",
      },
    });
    log.info("Created system user system_ai_forecast");
  }
  return u.id;
}

export async function runAiAlertCheck(): Promise<{ created: number; skipped: number }> {
  const stationMeta = getAllAiStationMeta();
  if (Object.keys(stationMeta).length === 0) {
    return { created: 0, skipped: 0 };
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - 60 * 60 * 1000); // 1h lookback for safety

  // Pull the live-AI forecasts for the future horizon across all stations.
  // We only consider dataSource = "samur-ai" — seasonal baselines are
  // tagged "samur-ai-climatology" and must never fire an alert.
  const forecasts = await prisma.riverLevel.findMany({
    where: {
      dataSource: "samur-ai",
      isForecast: true,
      deletedAt: null,
      measuredAt: { gte: windowStart },
    },
    select: {
      riverName: true,
      stationName: true,
      levelCm: true,
      dangerLevelCm: true,
      predictionUpper: true,
      measuredAt: true,
    },
    orderBy: { measuredAt: "asc" },
  });

  // Group by station and find the peak upper-bound across the horizon.
  type Peak = {
    riverName: string;
    stationName: string;
    upper: number;
    danger: number;
    pct: number;
    peakAt: Date;
  };
  const peaks = new Map<string, Peak>();
  for (const f of forecasts) {
    const danger = f.dangerLevelCm ?? 0;
    if (danger <= 0) continue;
    const upper = f.predictionUpper ?? f.levelCm ?? 0;
    if (upper <= 0) continue;
    const key = `${f.riverName}::${f.stationName}`;
    const pct = upper / danger;
    const existing = peaks.get(key);
    if (!existing || pct > existing.pct) {
      peaks.set(key, {
        riverName: f.riverName,
        stationName: f.stationName,
        upper,
        danger,
        pct,
        peakAt: f.measuredAt,
      });
    }
  }

  if (peaks.size === 0) return { created: 0, skipped: 0 };

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let authorId: string | null = null;
  let created = 0;
  let skipped = 0;

  for (const [key, peak] of peaks) {
    if (peak.pct < WARNING_THRESHOLD) continue;

    const meta = stationMeta[key];
    if (!meta || meta.tier === "low" || meta.tier === "none") continue;
    if (meta.source !== "live-observations" && meta.source !== "historical-imports") continue;

    const isAbove = peak.pct >= 1.0;
    const urgency = isAbove ? "critical" as const : "warning" as const;

    // Dedup: one alert per (station, day). Escalate warning → critical
    // within the same day if the situation worsens; never downgrade.
    const existing = await prisma.alert.findFirst({
      where: {
        sentAt: { gte: today },
        deletedAt: null,
        title: { contains: peak.stationName },
        author: { phone: SYSTEM_USER_PHONE },
      },
      select: { id: true, urgency: true },
    });
    if (existing) {
      const alreadyCritical = existing.urgency === "critical";
      if (alreadyCritical || !isAbove) {
        skipped++;
        continue;
      }
      // else: existing is warning and now we've hit critical → create the
      // upgraded alert so the user gets a fresh ping.
    }

    if (!authorId) authorId = await ensureSystemUser();

    const pctRounded = Math.round(peak.pct * 100);
    const dateRu = peak.peakAt.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
    const title = isAbove
      ? `🌊 Кунак AI: ${peak.riverName} — возможно превышение опасного уровня на станции ${peak.stationName}`
      : `🌊 Кунак AI: ${peak.riverName} — приближение к опасному уровню на станции ${peak.stationName}`;
    const body = [
      `Станция: ${peak.stationName}`,
      `Прогноз пика: ${Math.round(peak.upper)} см (${pctRounded}% от опасного)`,
      `Опасный уровень: ${peak.danger} см`,
      `Ожидается: ${dateRu}`,
      `Точность модели: ${meta.tier === "high" ? "высокая" : "средняя"}`,
      "",
      isAbove
        ? "Возможно превышение опасной отметки. Следите за обстановкой и будьте готовы к эвакуации."
        : "Уровень приближается к опасной отметке. Следите за обстановкой.",
    ].join("\n");

    try {
      const alert = await prisma.alert.create({
        data: {
          authorId,
          urgency,
          source: "ai_forecast",
          title,
          body,
          // AI alerts stay in-app only: the telegram/sms/meshtastic
          // channels are declared but not dispatched in this codebase
          // yet, and we don't want an auto-forecast to trigger a silent
          // no-op on those channels.
          channels: ["pwa"],
          expiresAt: new Date(Date.now() + ALERT_TTL_MS),
        },
        include: { author: { select: { id: true, name: true, role: true } } },
      });
      emitAlertBroadcast(alert as unknown as Alert);
      log.info(
        { station: key, urgency, pctOfDanger: pctRounded, peakAt: peak.peakAt.toISOString() },
        "AI alert created",
      );
      created++;
    } catch (err) {
      log.error({ err, station: key }, "Failed to create AI alert");
    }
  }

  return { created, skipped };
}
