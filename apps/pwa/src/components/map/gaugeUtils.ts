// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Gauge station visualization utilities.
 *
 * Converts raw discharge/level data into human-readable tiers,
 * colors, labels, and trend arrows for map markers.
 */

import type { RiverLevel } from "@samur/shared";

// ── Danger tier system (4 levels) ──────────────────────────────────────────

export interface GaugeTier {
  /** Tier number: 1 = normal, 2 = elevated, 3 = dangerous, 4 = critical */
  tier: 1 | 2 | 3 | 4;
  /** Russian label */
  label: string;
  /** Hex color for the tier */
  color: string;
  /** Percentage of mean discharge (e.g. 287 = 287% of normal) */
  pctOfMean: number;
  /** Whether this station has valid data */
  hasData: boolean;
}

export const TIER_COLORS = {
  1: "#22C55E", // green — normal
  2: "#F59E0B", // amber — elevated
  3: "#EF4444", // red — dangerous
  4: "#991B1B", // dark red — critical
  nodata: "#94A3B8", // slate — no data
} as const;

export const TIER_LABELS: Record<number, string> = {
  1: "Норма",
  2: "Повышенный",
  3: "Опасный",
  4: "Критический",
};

export const TIER_ACTIONS: Record<number, string> = {
  1: "Нет угрозы",
  2: "Следите за обстановкой",
  3: "Будьте готовы к эвакуации",
  4: "Немедленная эвакуация!",
};

// ── Tier calculation ───────────────────────────────────────────────────────

export function computeTier(r: RiverLevel): GaugeTier {
  const discharge = r.dischargeCubicM;
  const mean = r.dischargeMean;
  const levelCm = r.levelCm;
  const dangerCm = r.dangerLevelCm;

  // No data at all
  if (
    (discharge === null || discharge <= 0) &&
    (levelCm === null || levelCm <= 0)
  ) {
    return { tier: 1, label: TIER_LABELS[1], color: TIER_COLORS[1], pctOfMean: 0, hasData: false };
  }

  // CM-based calculation (if available)
  if (levelCm !== null && levelCm > 0 && dangerCm && dangerCm > 0) {
    const ratio = levelCm / dangerCm;
    const pct = Math.round(ratio * 100);
    if (ratio >= 1.0) return { tier: 4, label: TIER_LABELS[4], color: TIER_COLORS[4], pctOfMean: pct, hasData: true };
    if (ratio >= 0.75) return { tier: 3, label: TIER_LABELS[3], color: TIER_COLORS[3], pctOfMean: pct, hasData: true };
    if (ratio >= 0.5) return { tier: 2, label: TIER_LABELS[2], color: TIER_COLORS[2], pctOfMean: pct, hasData: true };
    return { tier: 1, label: TIER_LABELS[1], color: TIER_COLORS[1], pctOfMean: pct, hasData: true };
  }

  // Discharge-based calculation
  if (discharge !== null && discharge > 0 && mean && mean > 0) {
    const ratio = discharge / mean;
    const pct = Math.round(ratio * 100);

    // Check absolute danger threshold
    const dangerDischarge = r.dischargeMax; // dischargeMax serves as danger threshold
    if (dangerDischarge && dangerDischarge > 0 && discharge > dangerDischarge) {
      return { tier: 4, label: TIER_LABELS[4], color: TIER_COLORS[4], pctOfMean: pct, hasData: true };
    }

    if (ratio > 3.5) return { tier: 4, label: TIER_LABELS[4], color: TIER_COLORS[4], pctOfMean: pct, hasData: true };
    if (ratio > 2.5) return { tier: 3, label: TIER_LABELS[3], color: TIER_COLORS[3], pctOfMean: pct, hasData: true };
    if (ratio > 1.5) return { tier: 2, label: TIER_LABELS[2], color: TIER_COLORS[2], pctOfMean: pct, hasData: true };
    return { tier: 1, label: TIER_LABELS[1], color: TIER_COLORS[1], pctOfMean: pct, hasData: true };
  }

  // Has discharge but no mean — show data without tier classification
  if (discharge !== null && discharge > 0) {
    return { tier: 1, label: TIER_LABELS[1], color: TIER_COLORS[1], pctOfMean: 0, hasData: true };
  }

  return { tier: 1, label: TIER_LABELS[1], color: TIER_COLORS[1], pctOfMean: 0, hasData: false };
}

// ── Trend arrow ────────────────────────────────────────────────────────────

export function trendArrow(trend: string): string {
  switch (trend) {
    case "rising": return "↑";
    case "falling": return "↓";
    default: return "→";
  }
}

// ── Forecast warning ──────────────────────────────────────────────────────

export interface ForecastWarning {
  /** Whether a forecast crosses the danger threshold */
  hasDanger: boolean;
  /** Days until the danger crossing (0 = today) */
  daysUntil: number;
  /** Max forecasted tier */
  maxTier: 1 | 2 | 3 | 4;
  /** Max forecasted value (discharge or level) */
  maxValue: number;
  /** Human-readable warning text */
  text: string;
}

/**
 * Analyze forecast data to determine if danger thresholds will be crossed.
 *
 * @param history Array of history points (observed + forecast), sorted by date ascending
 * @param dangerDischarge Danger discharge threshold (m³/s)
 * @param meanDischarge Mean discharge for tier computation
 * @param mode Whether to use cm or discharge values
 * @param dangerCm Danger level in cm (for cm mode)
 */
export function computeForecastWarning(
  history: Array<{
    dischargeCubicM: number | null;
    dischargeMean: number | null;
    dischargeMax: number | null;
    levelCm: number | null;
    dangerLevelCm: number | null;
    isForecast: boolean;
    measuredAt: string;
  }>,
  mode: "cm" | "discharge",
): ForecastWarning | null {
  const forecastPoints = history.filter((p) => p.isForecast);
  if (forecastPoints.length === 0) return null;

  const now = Date.now();
  let maxTier: 1 | 2 | 3 | 4 = 1;
  let maxValue = 0;
  /** Days until the FIRST point that crosses each threshold */
  let elevatedDaysUntil = -1; // first tier >= 2
  let dangerDaysUntil = -1;   // first tier >= 3

  for (const p of forecastPoints) {
    let tier: 1 | 2 | 3 | 4 = 1;
    let value = 0;

    if (mode === "discharge" && p.dischargeCubicM !== null && p.dischargeCubicM > 0) {
      value = p.dischargeCubicM;
      const mean = p.dischargeMean ?? 0;
      const dMax = p.dischargeMax ?? 0;

      if (dMax > 0 && value > dMax) {
        tier = 4;
      } else if (mean > 0) {
        const ratio = value / mean;
        if (ratio > 3.5) tier = 4;
        else if (ratio > 2.5) tier = 3;
        else if (ratio > 1.5) tier = 2;
      }
    } else if (mode === "cm" && p.levelCm !== null && p.levelCm > 0) {
      value = p.levelCm;
      const dangerCm = p.dangerLevelCm ?? 0;
      if (dangerCm > 0) {
        const ratio = value / dangerCm;
        if (ratio >= 1.0) tier = 4;
        else if (ratio >= 0.75) tier = 3;
        else if (ratio >= 0.5) tier = 2;
      }
    }

    if (value > maxValue) maxValue = value;
    if (tier > maxTier) maxTier = tier;

    // Track first crossing of each threshold
    const daysAhead = Math.max(0, Math.round((new Date(p.measuredAt).getTime() - now) / (1000 * 60 * 60 * 24)));
    if (tier >= 2 && elevatedDaysUntil < 0) elevatedDaysUntil = daysAhead;
    if (tier >= 3 && dangerDaysUntil < 0) dangerDaysUntil = daysAhead;
  }

  if (maxTier < 2) return null;

  // Use danger crossing date if available, else elevated crossing date
  const targetDays = dangerDaysUntil >= 0 ? dangerDaysUntil : elevatedDaysUntil;

  const daysText = targetDays === 0
    ? "сегодня"
    : targetDays === 1
      ? "через 1 день"
      : `через ${targetDays} дн.`;

  let text: string;
  if (maxTier >= 3 && dangerDaysUntil >= 0) {
    text = `Прогноз: ${TIER_LABELS[maxTier].toLowerCase()} уровень ${daysText}`;
  } else {
    text = `Прогноз: повышение ${daysText}`;
  }

  return {
    hasDanger: maxTier >= 3,
    daysUntil: targetDays,
    maxTier,
    maxValue,
    text,
  };
}

// ── Heatmap weight (for Phase 3) ───────────────────────────────────────────

export function heatWeight(r: RiverLevel): number {
  if (r.dischargeCubicM === null || r.dischargeCubicM <= 0) return 0;
  if (!r.dischargeMean || r.dischargeMean <= 0) return 0;
  return Math.min((r.dischargeCubicM / r.dischargeMean) / 4, 1.0);
}
