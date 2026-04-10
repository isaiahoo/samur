// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Dynamic scenario awareness — connects real-time discharge data
 * to static flood damage scenario thresholds.
 *
 * Scientific basis:
 * - Proximity ratio: EFAS return-period thresholds (Kellens et al., 2013)
 * - Gumbel return period interpolation (extreme value distribution)
 * - Linear rate-of-rise extrapolation (UK Environment Agency approach)
 * - WMO impact-based communication guidelines (2021)
 */

import type { ScenarioLevel, FloodScenario } from "./floodScenarios.js";
import type { HistoryPoint } from "./GaugeChart.js";

// ── Types ─────────────────────────────────────────────────────────────────

export interface ScenarioProximity {
  scenarioId: ScenarioLevel;
  label: string;
  thresholdM3s: number;
  proximityRatio: number;   // 0..∞ (>1 = exceeded)
  proximityPct: number;     // round(ratio * 100), clamped 0..999
  isExceeded: boolean;
}

export interface ProximityBarData {
  baseline: number;
  current: number;
  forecastPeak: number | null;
  thresholds: Array<{ scenarioId: ScenarioLevel; value: number; label: string }>;
  barMax: number;
  mode: "discharge" | "cm";
}

export interface ReturnPeriodEstimate {
  years: number | null;
  label: string;
}

export interface TimeToThreshold {
  targetScenarioId: ScenarioLevel;
  targetLabel: string;
  etaHours: number;
  etaLabel: string;
  ratePerHour: number;
}

export interface ScenarioAwareness {
  proximities: ScenarioProximity[];
  barData: ProximityBarData;
  returnPeriod: ReturnPeriodEstimate | null;
  timeToThreshold: TimeToThreshold | null;
  nearestScenarioId: ScenarioLevel | null;
  shouldPulse: boolean;
}

// ── Tab labels for Russian display ────────────────────────────────────────

const SCENARIO_LABELS: Record<ScenarioLevel, string> = {
  moderate: "Умеренный",
  severe: "Серьёзный",
  catastrophic: "Катастроф.",
};

// ── Core math functions ───────────────────────────────────────────────────

/** Proximity ratio: how close current value is to a scenario threshold */
export function computeProximityRatio(
  current: number,
  baseline: number,
  threshold: number,
): number {
  if (threshold <= 0) return 0;
  // If baseline is 0 or >= threshold, use simple ratio
  if (baseline <= 0 || baseline >= threshold) {
    return current / threshold;
  }
  return (current - baseline) / (threshold - baseline);
}

/** Parse "1 раз в N лет" → N, or null for unparseable strings */
export function parseReturnYears(text: string): number | null {
  const m = text.match(/(\d+)\s*лет/);
  return m ? parseInt(m[1], 10) : null;
}

/** Gumbel reduced variate: y = -ln(-ln(1 - 1/T)) */
function gumbelY(T: number): number {
  return -Math.log(-Math.log(1 - 1 / T));
}

/** Inverse Gumbel: T from reduced variate y */
function gumbelT(y: number): number {
  return 1 / (1 - Math.exp(-Math.exp(-y)));
}

/**
 * Estimate the return period of the current discharge using Gumbel interpolation.
 *
 * Uses two scenario anchor points (T, Q) to fit the Gumbel linear model Q = a + b*y,
 * then inverts for the current Q.
 */
export function estimateReturnPeriod(
  scenarios: FloodScenario[],
  currentDischarge: number,
  baseline: number,
): ReturnPeriodEstimate | null {
  // Collect valid anchor pairs: (returnYears, peakDischargeM3s)
  const anchors: Array<{ T: number; Q: number; id: ScenarioLevel }> = [];
  for (const s of scenarios) {
    const T = parseReturnYears(s.returnPeriod);
    if (T !== null && T > 1) {
      anchors.push({ T, Q: s.peakDischargeM3s, id: s.scenarioId });
    }
  }

  if (anchors.length < 2) return null;

  // Sort by return period ascending, take first two valid anchors
  anchors.sort((a, b) => a.T - b.T);
  const a1 = anchors[0];
  const a2 = anchors[1];

  const y1 = gumbelY(a1.T);
  const y2 = gumbelY(a2.T);
  const dy = y2 - y1;
  if (Math.abs(dy) < 1e-10) return null;

  const b = (a2.Q - a1.Q) / dy;
  const a = a1.Q - b * y1;

  if (b <= 0) return null; // Degenerate — discharge should increase with return period

  // Current below baseline → trivial
  if (currentDischarge <= baseline) {
    return { years: null, label: "< 2 лет" };
  }

  const yCurrent = (currentDischarge - a) / b;
  const tCurrent = gumbelT(yCurrent);

  // Find max return period from scenarios (for clamping)
  const maxT = Math.max(...anchors.map((x) => x.T));
  // Also check if there's a catastrophic scenario beyond anchors
  const catastrophic = scenarios.find((s) => s.scenarioId === "catastrophic");
  const maxScenarioT = catastrophic ? (parseReturnYears(catastrophic.returnPeriod) ?? maxT) : maxT;

  if (tCurrent < 2) {
    return { years: null, label: "< 2 лет" };
  }
  if (tCurrent > maxScenarioT * 2 || !isFinite(tCurrent)) {
    return { years: null, label: `> ${maxScenarioT} лет` };
  }

  const rounded = tCurrent < 10 ? Math.round(tCurrent) : Math.round(tCurrent / 5) * 5;
  return { years: rounded, label: `~${rounded} лет` };
}

/**
 * Extract the peak forecast discharge (or level) from history.
 */
export function getForecastPeak(
  history: HistoryPoint[],
  mode: "discharge" | "cm",
): number | null {
  let peak: number | null = null;
  for (const p of history) {
    if (!p.isForecast) continue;
    const val = mode === "discharge" ? p.dischargeCubicM : p.levelCm;
    if (val !== null && val > 0 && (peak === null || val > peak)) {
      peak = val;
    }
  }
  return peak;
}

/**
 * Estimate time until the next scenario threshold is reached,
 * using linear extrapolation from recent observed points.
 */
export function estimateTimeToThreshold(
  history: HistoryPoint[],
  scenarios: FloodScenario[],
  currentValue: number,
  mode: "discharge" | "cm",
): TimeToThreshold | null {
  // Get recent observed points
  const observed = history.filter((p) => {
    if (p.isForecast) return false;
    const val = mode === "discharge" ? p.dischargeCubicM : p.levelCm;
    return val !== null && val > 0;
  });

  if (observed.length < 2) return null;

  const recent = observed.slice(-3);
  const first = recent[0];
  const last = recent[recent.length - 1];

  const v0 = mode === "discharge" ? first.dischargeCubicM! : first.levelCm!;
  const v1 = mode === "discharge" ? last.dischargeCubicM! : last.levelCm!;
  const dtHours =
    (new Date(last.measuredAt).getTime() - new Date(first.measuredAt).getTime()) / 3_600_000;

  if (dtHours <= 0) return null;

  const rate = (v1 - v0) / dtHours;
  if (rate <= 0) return null; // Not rising

  // Find the next un-exceeded scenario threshold
  const sortedScenarios = [...scenarios].sort(
    (a, b) => a.peakDischargeM3s - b.peakDischargeM3s,
  );
  const nextScenario = sortedScenarios.find((s) => s.peakDischargeM3s > currentValue);
  if (!nextScenario) return null;

  const gap = nextScenario.peakDischargeM3s - currentValue;
  const etaHours = gap / rate;

  // Only show if 1-168 hours (7 days)
  if (etaHours < 1 || etaHours > 168) return null;

  const etaLabel =
    etaHours < 2
      ? "~1 ч"
      : etaHours < 24
        ? `~${Math.round(etaHours)} ч`
        : `~${Math.round(etaHours / 24)} дн.`;

  return {
    targetScenarioId: nextScenario.scenarioId,
    targetLabel: SCENARIO_LABELS[nextScenario.scenarioId],
    etaHours,
    etaLabel,
    ratePerHour: rate,
  };
}

/**
 * Build the proximity bar data structure for rendering.
 */
export function buildProximityBarData(
  scenarios: FloodScenario[],
  current: number,
  baseline: number,
  forecastPeak: number | null,
  mode: "discharge" | "cm",
): ProximityBarData {
  const thresholds = scenarios.map((s) => ({
    scenarioId: s.scenarioId,
    value: s.peakDischargeM3s,
    label: SCENARIO_LABELS[s.scenarioId],
  }));
  thresholds.sort((a, b) => a.value - b.value);

  // Determine bar max — handle extreme ranges (Sulak dam break: 80,000 vs 1,200)
  const maxThreshold = thresholds.length > 0 ? thresholds[thresholds.length - 1].value : 0;
  const minThreshold = thresholds.length > 0 ? thresholds[0].value : 0;

  let barMax: number;
  if (thresholds.length >= 2 && maxThreshold / minThreshold > 10) {
    // Extreme range: cap at second-highest * 1.5
    const secondHighest = thresholds[thresholds.length - 2].value;
    barMax = secondHighest * 1.5;
  } else {
    barMax = maxThreshold * 1.15;
  }

  // Ensure bar covers current value and forecast
  barMax = Math.max(barMax, current * 1.1, (forecastPeak ?? 0) * 1.1);

  return { baseline, current, forecastPeak, thresholds, barMax, mode };
}

// ── Main entry point ──────────────────────────────────────────────────────

/**
 * Compute all scenario awareness data from current river conditions.
 *
 * Returns null when there's no meaningful data to display.
 */
export function computeScenarioAwareness(
  scenarios: FloodScenario[],
  currentDischarge: number | null,
  baseline: number,
  trend: string,
  history: HistoryPoint[],
  mode: "discharge" | "cm",
  levelCm?: number | null,
  dangerLevelCm?: number | null,
): ScenarioAwareness | null {
  if (scenarios.length === 0) return null;

  // Determine the current value to work with
  const currentValue =
    mode === "discharge"
      ? (currentDischarge && currentDischarge > 0 ? currentDischarge : null)
      : (levelCm && levelCm > 0 ? levelCm : null);

  if (currentValue === null) return null;

  // Compute proximity for each scenario
  const proximities: ScenarioProximity[] = scenarios.map((s) => {
    const ratio = computeProximityRatio(currentValue, baseline, s.peakDischargeM3s);
    return {
      scenarioId: s.scenarioId,
      label: SCENARIO_LABELS[s.scenarioId],
      thresholdM3s: s.peakDischargeM3s,
      proximityRatio: ratio,
      proximityPct: Math.min(Math.max(Math.round(ratio * 100), 0), 999),
      isExceeded: ratio >= 1.0,
    };
  });

  // Forecast peak
  const forecastPeak = getForecastPeak(history, mode);

  // Bar data
  const barData = buildProximityBarData(scenarios, currentValue, baseline, forecastPeak, mode);

  // Return period (only for discharge mode)
  const returnPeriod =
    mode === "discharge" && currentDischarge && currentDischarge > 0
      ? estimateReturnPeriod(scenarios, currentDischarge, baseline)
      : null;

  // Time-to-threshold (only when rising)
  const timeToThreshold =
    trend === "rising"
      ? estimateTimeToThreshold(history, scenarios, currentValue, mode)
      : null;

  // Nearest un-exceeded scenario
  const nearest = proximities.find((p) => !p.isExceeded);
  const nearestScenarioId = nearest?.scenarioId ?? null;

  // Pulse when nearest proximity > 30%
  const shouldPulse = nearest !== undefined && nearest.proximityPct > 30;

  return {
    proximities,
    barData,
    returnPeriod,
    timeToThreshold,
    nearestScenarioId,
    shouldPulse,
  };
}
