// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Creates DOM elements for gauge station map markers.
 *
 * Three zoom-adaptive variants:
 *   - Dot (zoom < 7):   colored circle, 16px
 *   - Pill (zoom 7-9):  rounded pill with river name, trend SVG, pct chip
 *   - Card (zoom ≥ 10): info card with tier label, pct, and optional notes
 *
 * Pill + card markers compose a wrapper with the visible label above and a
 * tiny colored anchor dot at the geographic coordinate so the exact station
 * location is always clear even when the label is shifted by layout.
 */

import type { GaugeTier, ForecastWarning, UpstreamWarning } from "./gaugeUtils.js";

export type MarkerVariant = "dot" | "pill" | "card";

/** Escape HTML entities to prevent XSS from API-sourced text */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Format pctOfMean as "выше/ниже нормы" */
function formatPct(pct: number): string {
  if (pct <= 0) return "Нет данных";
  const diff = Math.round(pct - 100);
  if (diff === 0) return "Норма";
  if (diff > 0) return `на ${diff}% выше нормы`;
  return `на ${Math.abs(diff)}% ниже нормы`;
}

/** Inline SVG for trend direction. `trend` is "rising" | "falling" | "stable". */
function trendIconHTML(trend: string): string {
  const attrs = 'width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  if (trend === "rising") {
    return `<svg class="gauge-trend gauge-trend--up" ${attrs}><path d="M7 17l5-5 5 5"/><path d="M12 12V4"/></svg>`;
  }
  if (trend === "falling") {
    return `<svg class="gauge-trend gauge-trend--down" ${attrs}><path d="M7 7l5 5 5-5"/><path d="M12 12v8"/></svg>`;
  }
  return `<svg class="gauge-trend" ${attrs}><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>`;
}

export function variantForZoom(zoom: number): MarkerVariant {
  if (zoom < 7) return "dot";
  if (zoom < 10) return "pill";
  return "card";
}

// ── Dot marker (zoom < 7) ──────────────────────────────────────────────────

function createDotElement(tier: GaugeTier, upstream?: UpstreamWarning | null, hasAi?: boolean): HTMLDivElement {
  const el = document.createElement("div");
  el.className = tier.hasData ? `gauge-dot tier-${tier.tier}` : "gauge-dot tier-nodata";
  if (tier.tier >= 3 && tier.hasData) el.className += " gauge-pulse";
  if (upstream) el.className += " gauge-upstream-ring";
  if (hasAi) el.className += " gauge-ai-ring";
  return el;
}

// ── Pill marker (zoom 7-9) ─────────────────────────────────────────────────

function pillInnerHTML(
  riverName: string,
  trend: string,
  tier: GaugeTier,
  forecast?: ForecastWarning | null,
  upstream?: UpstreamWarning | null,
): string {
  const name = esc(riverName);
  const arrow = tier.hasData ? trendIconHTML(trend) : "";
  const pct = tier.hasData && tier.tier >= 2
    ? `<span class="gauge-pill-pct">${tier.pctOfMean}%</span>`
    : "";
  const warn = forecast?.hasDanger ? `<span class="gauge-pill-flag" aria-label="Прогноз опасности">⚠</span>` : "";
  const up = upstream ? `<span class="gauge-pill-flag" aria-label="Опасность выше по течению">▲</span>` : "";
  return `<span class="gauge-pill-name">${name}</span>${arrow}${pct}${warn}${up}`;
}

function createPillElement(
  riverName: string,
  trend: string,
  tier: GaugeTier,
  forecast?: ForecastWarning | null,
  upstream?: UpstreamWarning | null,
  hasAi?: boolean,
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "gauge-marker gauge-marker--pill";

  const pillClasses = ["gauge-pill"];
  pillClasses.push(tier.hasData ? `tier-${tier.tier}` : "tier-nodata");
  if (tier.tier >= 3 && tier.hasData) pillClasses.push("gauge-pulse");
  if (upstream) pillClasses.push("gauge-upstream-ring");
  if (hasAi) pillClasses.push("gauge-ai-ring");

  const dotClasses = ["gauge-anchor-dot"];
  dotClasses.push(tier.hasData ? `tier-${tier.tier}` : "tier-nodata");

  wrap.innerHTML = `<div class="${pillClasses.join(" ")}">${pillInnerHTML(riverName, trend, tier, forecast, upstream)}</div><div class="${dotClasses.join(" ")}"></div>`;
  return wrap;
}

// ── Card marker (zoom ≥ 10) ────────────────────────────────────────────────

function cardInnerHTML(
  riverName: string,
  stationName: string,
  trend: string,
  tier: GaugeTier,
  forecast?: ForecastWarning | null,
  upstream?: UpstreamWarning | null,
  hasAi?: boolean,
  aiSummary?: string | null,
): string {
  const pctText = formatPct(tier.pctOfMean);
  const tierLabel = tier.hasData ? esc(tier.label) : "—";
  const arrow = tier.hasData ? trendIconHTML(trend) : "";

  const forecastHTML = forecast?.hasDanger
    ? `<div class="gauge-card-forecast">⚠ ${esc(forecast.text)}</div>`
    : "";
  const upstreamHTML = upstream
    ? `<div class="gauge-card-upstream">▲ ${esc(upstream.text)}</div>`
    : "";
  const aiHTML = hasAi && aiSummary
    ? `<div class="gauge-card-ai">${esc(aiSummary)}</div>`
    : "";

  return `<div class="gauge-card-header"><span class="gauge-card-river">${esc(riverName)} — ${esc(stationName)}</span></div>`
    + `<div class="gauge-card-body"><span class="gauge-card-tier">${tierLabel}${arrow}</span><span class="gauge-card-pct">${esc(pctText)}</span></div>`
    + `${forecastHTML}${upstreamHTML}${aiHTML}`;
}

function createCardElement(
  riverName: string,
  stationName: string,
  trend: string,
  tier: GaugeTier,
  forecast?: ForecastWarning | null,
  upstream?: UpstreamWarning | null,
  hasAi?: boolean,
  aiSummary?: string | null,
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "gauge-marker gauge-marker--card";

  const cardClasses = ["gauge-card"];
  cardClasses.push(tier.hasData ? `tier-${tier.tier}` : "tier-nodata");
  if (tier.tier >= 3 && tier.hasData) cardClasses.push("gauge-pulse");
  if (upstream) cardClasses.push("gauge-upstream-ring");
  if (hasAi) cardClasses.push("gauge-ai-ring");

  const dotClasses = ["gauge-anchor-dot"];
  dotClasses.push(tier.hasData ? `tier-${tier.tier}` : "tier-nodata");

  wrap.innerHTML = `<div class="${cardClasses.join(" ")}">${cardInnerHTML(riverName, stationName, trend, tier, forecast, upstream, hasAi, aiSummary)}</div><div class="${dotClasses.join(" ")}"></div>`;
  return wrap;
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface GaugeMarkerData {
  riverName: string;
  stationName: string;
  trend: string;
  tier: GaugeTier;
  forecast?: ForecastWarning | null;
  upstream?: UpstreamWarning | null;
  hasAiForecast?: boolean;
  aiSummary?: string | null;
}

export function createMarkerElement(
  data: GaugeMarkerData,
  variant: MarkerVariant,
): HTMLDivElement {
  switch (variant) {
    case "dot":
      return createDotElement(data.tier, data.upstream, data.hasAiForecast);
    case "pill":
      return createPillElement(data.riverName, data.trend, data.tier, data.forecast, data.upstream, data.hasAiForecast);
    case "card":
      return createCardElement(data.riverName, data.stationName, data.trend, data.tier, data.forecast, data.upstream, data.hasAiForecast, data.aiSummary);
  }
}

/**
 * Update an existing marker element in-place by swapping inner markup.
 * Returns true if the variant changed and the caller should rebuild.
 */
export function updateMarkerElement(
  existing: HTMLDivElement,
  data: GaugeMarkerData,
  newVariant: MarkerVariant,
  currentVariant: MarkerVariant,
): boolean {
  if (newVariant !== currentVariant) return true;

  const tierClass = data.tier.hasData ? `tier-${data.tier.tier}` : "tier-nodata";
  const pulseClass = data.tier.tier >= 3 && data.tier.hasData ? " gauge-pulse" : "";
  const upClass = data.upstream ? " gauge-upstream-ring" : "";
  const aiClass = data.hasAiForecast ? " gauge-ai-ring" : "";

  if (newVariant === "dot") {
    existing.className = `gauge-dot ${tierClass}${pulseClass}${upClass}${aiClass}`;
    return false;
  }

  // Pill + card: update wrapper + inner markup
  const innerPill = newVariant === "pill";
  const inner = innerPill
    ? pillInnerHTML(data.riverName, data.trend, data.tier, data.forecast, data.upstream)
    : cardInnerHTML(data.riverName, data.stationName, data.trend, data.tier, data.forecast, data.upstream, data.hasAiForecast, data.aiSummary);
  const mainClass = innerPill ? "gauge-pill" : "gauge-card";
  existing.className = `gauge-marker gauge-marker--${newVariant}`;
  existing.innerHTML = `<div class="${mainClass} ${tierClass}${pulseClass}${upClass}${aiClass}">${inner}</div><div class="gauge-anchor-dot ${tierClass}"></div>`;
  return false;
}
