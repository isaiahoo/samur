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
  /** Percentage of the station's seasonal/annual mean — 100 = baseline,
   * >100 = above normal flow. Null when the station has no meaningful
   * mean reference (e.g. CM-based gauges without historical mean). */
  pctOfMean: number | null;
  /** Percentage of the station's danger threshold — 0 = safe, 100 =
   * at flood line, >100 = above flood line. Null when no danger
   * threshold is available for this station. */
  pctOfDanger: number | null;
  /** Which reference the UI should lead with. "danger" means the
   * station has a hard flood line; "mean" means only a seasonal
   * baseline is available; "none" means no reference — show the
   * tier label without a numeric framing. */
  referenceMode: "danger" | "mean" | "none";
  /** Whether this station has valid data */
  hasData: boolean;
}

export const TIER_COLORS = {
  1: "#16a34a", // green-600 — normal (WCAG AA with white text)
  2: "#b45309", // amber-700 — elevated (WCAG AA with white text)
  3: "#dc2626", // red-600 — dangerous
  4: "#991B1B", // dark red — critical
  nodata: "#71717a", // zinc-500 — no data
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
  const annualMean = r.dischargeAnnualMean;
  const dailyMean = r.dischargeMean;
  const levelCm = r.levelCm;
  const dangerCm = r.dangerLevelCm;

  const base = { pctOfMean: null, pctOfDanger: null, referenceMode: "none" as const };

  // No data at all
  if (
    (discharge === null || discharge <= 0) &&
    (levelCm === null || levelCm <= 0)
  ) {
    return { tier: 1, label: TIER_LABELS[1], color: TIER_COLORS[1], ...base, hasData: false };
  }

  // CM-based calculation (if available). Level vs danger threshold is the
  // cleanest reference a user can reason about — "how close to flooding".
  // Seasonal-mean context is not reliably available at CM gauges yet, so
  // pctOfMean stays null here and the UI leads with pctOfDanger.
  if (levelCm !== null && levelCm > 0 && dangerCm && dangerCm > 0) {
    const ratio = levelCm / dangerCm;
    const pctOfDanger = Math.round(ratio * 100);
    const cmBase = { pctOfMean: null, pctOfDanger, referenceMode: "danger" as const, hasData: true };
    if (ratio >= 1.0) return { tier: 4, label: TIER_LABELS[4], color: TIER_COLORS[4], ...cmBase };
    if (ratio >= 0.75) return { tier: 3, label: TIER_LABELS[3], color: TIER_COLORS[3], ...cmBase };
    if (ratio >= 0.5) return { tier: 2, label: TIER_LABELS[2], color: TIER_COLORS[2], ...cmBase };
    return { tier: 1, label: TIER_LABELS[1], color: TIER_COLORS[1], ...cmBase };
  }

  // Discharge-based calculation — prefer annual mean over daily mean.
  // Daily mean tracks seasonal patterns so closely that ratio is always ~1.0.
  // Annual mean shows meaningful seasonal variation.
  const mean = (annualMean && annualMean > 0) ? annualMean : (dailyMean && dailyMean > 0 ? dailyMean : null);

  if (discharge !== null && discharge > 0 && mean && mean > 0) {
    const ratio = discharge / mean;
    const pctOfMean = Math.round(ratio * 100);
    // Discharge-mode stations don't surface a reliable danger threshold
    // to this row: dischargeMax is the ensemble max from the GloFAS
    // forecast, which in practice equals today's discharge (~100% every
    // time) — not a flood line. We rely on the ratio thresholds below
    // for tier classification and leave pctOfDanger null.
    const qBase = {
      pctOfMean,
      pctOfDanger: null,
      referenceMode: "mean" as const,
      hasData: true,
    };
    if (ratio > 2.5) return { tier: 4, label: TIER_LABELS[4], color: TIER_COLORS[4], ...qBase };
    if (ratio > 1.5) return { tier: 3, label: TIER_LABELS[3], color: TIER_COLORS[3], ...qBase };
    if (ratio > 1.15) return { tier: 2, label: TIER_LABELS[2], color: TIER_COLORS[2], ...qBase };
    return { tier: 1, label: TIER_LABELS[1], color: TIER_COLORS[1], ...qBase };
  }

  // Has discharge but no mean — show data without tier classification.
  if (discharge !== null && discharge > 0) {
    return { tier: 1, label: TIER_LABELS[1], color: TIER_COLORS[1], ...base, hasData: true };
  }

  return { tier: 1, label: TIER_LABELS[1], color: TIER_COLORS[1], ...base, hasData: false };
}

// ── Reference-aware framing ───────────────────────────────────────────────

/**
 * Compact numeric label for a gauge marker. Returns null when no
 * reference is available. Format is reference-aware:
 *   - danger mode (CM stations): "71%" — fraction toward the flood line
 *   - mean mode   (discharge):   "+39%" / "−18%" — signed delta vs. the
 *     seasonal mean, so users don't mistake the raw 139% for "at danger"
 * Two labels, one consistent mental model: how far from the baseline.
 */
export function pctForMarker(tier: GaugeTier): string | null {
  if (!tier.hasData) return null;
  if (tier.referenceMode === "danger" && tier.pctOfDanger !== null) {
    return `${tier.pctOfDanger}%`;
  }
  if (tier.referenceMode === "mean" && tier.pctOfMean !== null) {
    const diff = Math.round(tier.pctOfMean - 100);
    if (diff === 0) return "норма";
    const sign = diff > 0 ? "+" : "−";
    return `${sign}${Math.abs(diff)}%`;
  }
  return null;
}

/**
 * Full sentence for the detail-panel hero. Chooses the reference that
 * exists for this station and phrases it honestly: "71% до опасного
 * уровня" for CM-mode gauges (the canonical safety-margin framing),
 * "на 50% выше/ниже нормы" for discharge-mode stations where we have a
 * seasonal mean, or just "Норма" / the tier label when neither applies.
 */
export function tierHeroText(tier: GaugeTier): string {
  if (!tier.hasData) return tier.label;

  if (tier.referenceMode === "danger" && tier.pctOfDanger !== null) {
    if (tier.pctOfDanger >= 100) return "Опасный уровень достигнут";
    if (tier.pctOfDanger < 10) return "Норма";
    return `${tier.pctOfDanger}% до опасного уровня`;
  }

  if (tier.referenceMode === "mean" && tier.pctOfMean !== null) {
    const diff = Math.round(tier.pctOfMean - 100);
    if (diff === 0) return "Норма";
    if (diff > 0) return `на ${diff}% выше нормы`;
    return `на ${Math.abs(diff)}% ниже нормы`;
  }

  return tier.label;
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
    dischargeAnnualMean?: number | null;
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
      const annualMean = p.dischargeAnnualMean ?? 0;
      const dailyMean = p.dischargeMean ?? 0;
      const mean = annualMean > 0 ? annualMean : dailyMean;
      const dMax = p.dischargeMax ?? 0;

      if (dMax > 0 && value > dMax) {
        tier = 4;
      } else if (mean > 0) {
        const ratio = value / mean;
        if (ratio > 2.5) tier = 4;
        else if (ratio > 1.5) tier = 3;
        else if (ratio > 1.15) tier = 2;
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

// ── Upstream-downstream early warning (Phase 5) ──────────────────────────

/**
 * River chain config: stations ordered upstream → downstream.
 * Key = main river name, value = station names in upstream-first order.
 */
export const RIVER_CHAINS: Record<string, string[]> = {
  "Самур": ["Усухчай", "Ахты", "Лучек", "Устье (дельта)"],
  "Сулак": ["Кули", "Гергебиль", "Красный Мост", "Чиркота", "Миатлы", "Языковка", "Сулак"],
  "Терек": ["Хангаш-Юрт", "Хасавюрт", "Аликазган", "Каргалинский гидроузел"],
};

/** Tributaries that feed into a main river */
export const TRIBUTARY_MAP: Record<string, string> = {
  "Аварское Койсу": "Сулак",
  "Андийское Койсу": "Сулак",
  "Казикумухское Койсу": "Сулак",
  "Кара-Койсу": "Сулак",
  "Аксай": "Терек",
};

export interface UpstreamWarning {
  /** Name of the upstream station with danger */
  upstreamStation: string;
  /** Name of the upstream river (may differ for tributaries) */
  upstreamRiver: string;
  /** Tier of the upstream station */
  upstreamTier: 1 | 2 | 3 | 4;
  /** Warning text for display */
  text: string;
}

/**
 * Check if any upstream station has dangerous levels that could
 * propagate downstream to the given station.
 *
 * Returns a warning if an upstream station is tier >= 3 AND
 * the current station is tier <= 2 (i.e. danger hasn't arrived yet).
 */
export function checkUpstreamDanger(
  riverName: string,
  stationName: string,
  currentTier: GaugeTier,
  allLevels: RiverLevel[],
): UpstreamWarning | null {
  // Only warn if this station is NOT already in danger
  if (currentTier.tier >= 3) return null;

  // Resolve the main river (tributaries map to their main river)
  const mainRiver = TRIBUTARY_MAP[riverName] ?? riverName;
  const chain = RIVER_CHAINS[mainRiver];
  if (!chain) return null;

  // Find this station's position in the chain
  const myIndex = chain.indexOf(stationName);
  if (myIndex < 0) return null; // station not in chain (e.g. tributaries themselves)

  // Check all upstream stations (lower index = further upstream)
  for (let i = 0; i < myIndex; i++) {
    const upStation = chain[i];
    // Find this upstream station's data — check main river first, then tributaries
    const upLevel = allLevels.find(
      (r) => r.stationName === upStation && (r.riverName === mainRiver || TRIBUTARY_MAP[r.riverName] === mainRiver),
    );
    if (!upLevel) continue;

    const upTier = computeTier(upLevel);
    if (upTier.tier >= 3) {
      const upRiver = upLevel.riverName;
      return {
        upstreamStation: upStation,
        upstreamRiver: upRiver,
        upstreamTier: upTier.tier,
        text: `Выше по течению: ${TIER_LABELS[upTier.tier].toLowerCase()} уровень (${upRiver} — ${upStation})`,
      };
    }
  }

  // Also check tributary stations feeding into this river
  if (mainRiver === riverName) {
    for (const [tribRiver, mainTarget] of Object.entries(TRIBUTARY_MAP)) {
      if (mainTarget !== mainRiver) continue;
      // Find any station on this tributary
      for (const r of allLevels) {
        if (r.riverName !== tribRiver) continue;
        const tribTier = computeTier(r);
        if (tribTier.tier >= 3) {
          return {
            upstreamStation: r.stationName,
            upstreamRiver: tribRiver,
            upstreamTier: tribTier.tier,
            text: `Приток ${tribRiver}: ${TIER_LABELS[tribTier.tier].toLowerCase()} уровень (${r.stationName})`,
          };
        }
      }
    }
  }

  return null;
}
