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

// ── Heatmap weight (for Phase 3) ───────────────────────────────────────────

export function heatWeight(r: RiverLevel): number {
  if (r.dischargeCubicM === null || r.dischargeCubicM <= 0) return 0;
  if (!r.dischargeMean || r.dischargeMean <= 0) return 0;
  return Math.min((r.dischargeCubicM / r.dischargeMean) / 4, 1.0);
}
