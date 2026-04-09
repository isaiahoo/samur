// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Creates DOM elements for gauge station map markers.
 *
 * Three zoom-adaptive variants:
 *   - Dot (zoom < 7):   colored circle, 16px
 *   - Pill (zoom 7-9):  colored badge with river name + trend arrow
 *   - Card (zoom ≥ 10): full info card with tier label + % of mean
 */

import type { GaugeTier, ForecastWarning, UpstreamWarning } from "./gaugeUtils.js";

export type MarkerVariant = "dot" | "pill" | "card";

/** Escape HTML entities to prevent XSS from API-sourced text */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function variantForZoom(zoom: number): MarkerVariant {
  if (zoom < 7) return "dot";
  if (zoom < 10) return "pill";
  return "card";
}

// ── Dot marker (zoom < 7) ──────────────────────────────────────────────────

function createDotElement(tier: GaugeTier, upstream?: UpstreamWarning | null): HTMLDivElement {
  const el = document.createElement("div");
  el.className = tier.hasData ? `gauge-dot tier-${tier.tier}` : "gauge-dot tier-nodata";
  if (tier.tier >= 3 && tier.hasData) el.className += " gauge-pulse";
  if (upstream) el.className += " gauge-upstream-ring";
  return el;
}

// ── Pill marker (zoom 7-9) ─────────────────────────────────────────────────

function createPillElement(
  riverName: string,
  arrow: string,
  tier: GaugeTier,
  forecast?: ForecastWarning | null,
  upstream?: UpstreamWarning | null,
): HTMLDivElement {
  const el = document.createElement("div");
  el.className = tier.hasData ? `gauge-pill tier-${tier.tier}` : "gauge-pill tier-nodata";
  if (tier.tier >= 3 && tier.hasData) el.className += " gauge-pulse";
  if (upstream) el.className += " gauge-upstream-ring";

  const text = tier.hasData ? `${riverName} ${arrow}` : riverName;
  const warn = forecast?.hasDanger ? " \u26A0" : "";
  const upWarn = upstream ? " \u25B2" : ""; // ▲ upstream indicator
  el.textContent = text + warn + upWarn;
  return el;
}

// ── Card marker (zoom ≥ 10) ────────────────────────────────────────────────

function createCardElement(
  riverName: string,
  stationName: string,
  arrow: string,
  tier: GaugeTier,
  forecast?: ForecastWarning | null,
  upstream?: UpstreamWarning | null,
): HTMLDivElement {
  const el = document.createElement("div");
  el.className = tier.hasData ? `gauge-card tier-${tier.tier}` : "gauge-card tier-nodata";
  if (tier.tier >= 3 && tier.hasData) el.className += " gauge-pulse";
  if (upstream) el.className += " gauge-upstream-ring";

  const pctText = tier.pctOfMean > 0 ? `${tier.pctOfMean}% от нормы` : "Нет данных";

  const forecastHTML = forecast?.hasDanger
    ? `<div class="gauge-card-forecast">\u26A0 ${esc(forecast.text)}</div>`
    : "";

  const upstreamHTML = upstream
    ? `<div class="gauge-card-upstream">\u25B2 ${esc(upstream.text)}</div>`
    : "";

  el.innerHTML = `<div class="gauge-card-header"><span class="gauge-card-river">${esc(riverName)} — ${esc(stationName)}</span></div><div class="gauge-card-body"><span class="gauge-card-tier">${tier.hasData ? esc(tier.label) : "—"} ${esc(arrow)}</span><span class="gauge-card-pct">${esc(pctText)}</span></div>${forecastHTML}${upstreamHTML}`;
  return el;
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface GaugeMarkerData {
  riverName: string;
  stationName: string;
  arrow: string;
  tier: GaugeTier;
  forecast?: ForecastWarning | null;
  upstream?: UpstreamWarning | null;
}

export function createMarkerElement(
  data: GaugeMarkerData,
  variant: MarkerVariant,
): HTMLDivElement {
  switch (variant) {
    case "dot":
      return createDotElement(data.tier, data.upstream);
    case "pill":
      return createPillElement(data.riverName, data.arrow, data.tier, data.forecast, data.upstream);
    case "card":
      return createCardElement(data.riverName, data.stationName, data.arrow, data.tier, data.forecast, data.upstream);
  }
}

/**
 * Update an existing marker element in-place by swapping its class + content.
 * Returns true if the element was replaced (caller should swap the marker).
 */
export function updateMarkerElement(
  existing: HTMLDivElement,
  data: GaugeMarkerData,
  newVariant: MarkerVariant,
  currentVariant: MarkerVariant,
): boolean {
  // If variant changed, we need a full rebuild
  if (newVariant !== currentVariant) return true;

  // Same variant — update in-place
  const tierClass = data.tier.hasData ? `tier-${data.tier.tier}` : "tier-nodata";
  const pulseClass = data.tier.tier >= 3 && data.tier.hasData ? " gauge-pulse" : "";

  const upClass = data.upstream ? " gauge-upstream-ring" : "";

  if (newVariant === "dot") {
    existing.className = `gauge-dot ${tierClass}${pulseClass}${upClass}`;
    return false;
  }

  if (newVariant === "pill") {
    existing.className = `gauge-pill ${tierClass}${pulseClass}${upClass}`;
    const warn = data.forecast?.hasDanger ? " \u26A0" : "";
    const upWarn = data.upstream ? " \u25B2" : "";
    existing.textContent = (data.tier.hasData ? `${data.riverName} ${data.arrow}` : data.riverName) + warn + upWarn;
    return false;
  }

  // Card — update inner HTML
  existing.className = `gauge-card ${tierClass}${pulseClass}${upClass}`;
  const pctText = data.tier.pctOfMean > 0 ? `${data.tier.pctOfMean}% от нормы` : "Нет данных";
  const forecastHTML = data.forecast?.hasDanger
    ? `<div class="gauge-card-forecast">\u26A0 ${esc(data.forecast.text)}</div>`
    : "";
  const upstreamHTML = data.upstream
    ? `<div class="gauge-card-upstream">\u25B2 ${esc(data.upstream.text)}</div>`
    : "";
  existing.innerHTML = `<div class="gauge-card-header"><span class="gauge-card-river">${esc(data.riverName)} — ${esc(data.stationName)}</span></div><div class="gauge-card-body"><span class="gauge-card-tier">${data.tier.hasData ? esc(data.tier.label) : "—"} ${esc(data.arrow)}</span><span class="gauge-card-pct">${esc(pctText)}</span></div>${forecastHTML}${upstreamHTML}`;
  return false;
}
