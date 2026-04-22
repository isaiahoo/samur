// SPDX-License-Identifier: AGPL-3.0-only
import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Category icons for help-request markers, loaded into MapLibre as
 * SDF (signed-distance-field) images so they can be re-coloured at
 * render time via `icon-color`. Lets us keep one glyph per category
 * and tint it to match the marker's urgency/type palette without
 * shipping 24 differently-coloured PNGs.
 *
 * Drawn at 48px internally — MapLibre handles re-sampling via
 * `icon-size`. White on transparent is the SDF convention; the
 * layer paints the alpha channel in whatever colour we ask.
 *
 * Source SVGs are hand-tuned outline glyphs, tracked-width stroke
 * so they read at ~10px on-screen.
 */

const SIZE = 48;
/** Keyed by HelpCategory (see packages/shared/src/types/index.ts).
 * Keep in sync with that enum — a missing icon falls back to "other"
 * at render-time, but adding a category to the enum without adding a
 * glyph here is a design-review smell. */
const ICONS: Record<string, string> = {
  // Rescue — life ring
  rescue: `<circle cx="24" cy="24" r="16" fill="none" stroke="white" stroke-width="4"/><circle cx="24" cy="24" r="7" fill="none" stroke="white" stroke-width="4"/><path d="M24 3v10M24 35v10M3 24h10M35 24h10" stroke="white" stroke-width="4" stroke-linecap="round"/>`,
  // Shelter — house
  shelter: `<path d="M6 24l18-16 18 16" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/><path d="M10 22v18a2 2 0 002 2h24a2 2 0 002-2V22" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/>`,
  // Food — bowl with steam
  food: `<path d="M8 24h32v3a13 13 0 01-13 13h-6a13 13 0 01-13-13v-3z" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/><path d="M18 10c0 3 4 3 4 6s-4 3-4 6M26 10c0 3 4 3 4 6s-4 3-4 6" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"/>`,
  // Water — droplet
  water: `<path d="M24 6l-10 16a10 10 0 0020 0L24 6z" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/>`,
  // Medicine — cross in square
  medicine: `<rect x="7" y="7" width="34" height="34" rx="5" fill="none" stroke="white" stroke-width="4"/><path d="M24 15v18M15 24h18" stroke="white" stroke-width="4" stroke-linecap="round"/>`,
  // Equipment — toolbox
  equipment: `<path d="M6 18h36v20a2 2 0 01-2 2H8a2 2 0 01-2-2V18z" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/><path d="M18 18v-4a3 3 0 013-3h6a3 3 0 013 3v4" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/><path d="M18 28h12" stroke="white" stroke-width="4" stroke-linecap="round"/>`,
  // Transport — van
  transport: `<path d="M6 32V18a4 4 0 014-4h20a4 4 0 014 4v4h5a3 3 0 013 3v7" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/><path d="M4 32h40" stroke="white" stroke-width="4" stroke-linecap="round"/><circle cx="14" cy="35" r="4" fill="none" stroke="white" stroke-width="3"/><circle cx="34" cy="35" r="4" fill="none" stroke="white" stroke-width="3"/>`,
  // Labor — helping hand / person
  labor: `<circle cx="24" cy="14" r="6" fill="none" stroke="white" stroke-width="4"/><path d="M10 42c0-8 6-14 14-14s14 6 14 14" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/>`,
  // Generator — lightning bolt
  generator: `<path d="M26 4L10 26h10l-4 18 16-22H22l4-18z" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/>`,
  // Pump — arrow up from water waves
  pump: `<path d="M24 8v22M16 18l8-10 8 10" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 36c3 3 5 3 8 0s5-3 8 0 5 3 8 0 5-3 8 0" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/>`,
  // Childcare — parent + child silhouettes
  childcare: `<circle cx="16" cy="14" r="5" fill="none" stroke="white" stroke-width="4"/><circle cx="32" cy="18" r="3.5" fill="none" stroke="white" stroke-width="3"/><path d="M7 42c0-6 4-10 9-10s9 4 9 10" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M26 42c0-4 3-7 6-7s6 3 6 7" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"/>`,
  // Petcare — paw print
  petcare: `<circle cx="12" cy="22" r="3.5" fill="white"/><circle cx="20" cy="14" r="3.5" fill="white"/><circle cx="28" cy="14" r="3.5" fill="white"/><circle cx="36" cy="22" r="3.5" fill="white"/><path d="M14 34c0-5 4-8 10-8s10 3 10 8c0 4-3 6-10 6s-10-2-10-6z" fill="none" stroke="white" stroke-width="4"/>`,
  // Tutoring — open book
  tutoring: `<path d="M6 10a4 4 0 014-4h10v30H10a4 4 0 00-4 4V10z" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/><path d="M42 10a4 4 0 00-4-4H28v30h10a4 4 0 014 4V10z" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/>`,
  // Errands — shopping bag with check
  errands: `<path d="M10 14h28l-2 26a3 3 0 01-3 3H15a3 3 0 01-3-3L10 14z" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/><path d="M18 14V8a6 6 0 0112 0v6" fill="none" stroke="white" stroke-width="4"/><path d="M18 28l4 4 8-8" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  // Repair — wrench
  repair: `<path d="M30 6a9 9 0 01-12 12L6 30l6 6 12-12a9 9 0 0112-12l-6 6-6 2v-6l6-6z" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/>`,
  // Giveaway — gift box with ribbon
  giveaway: `<path d="M6 22h36v18a2 2 0 01-2 2H8a2 2 0 01-2-2V22z" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/><path d="M4 14h40v8H4z" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/><path d="M24 42V14" fill="none" stroke="white" stroke-width="4"/><path d="M24 14s-3-8-8-8a4 4 0 000 8h8zM24 14s3-8 8-8a4 4 0 010 8h-8z" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/>`,
  // Fallback — question mark in circle
  other: `<circle cx="24" cy="24" r="16" fill="none" stroke="white" stroke-width="4"/><path d="M18 19a6 6 0 016-6 5 5 0 015 5c0 3-5 4-5 7v1M24 34v.5" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/>`,
  // SOS glyph — bold cross, worn by the SOS variant of the marker
  sos: `<path d="M24 10v28M10 24h28" stroke="white" stroke-width="6" stroke-linecap="round"/>`,

  // ── Incident-type glyphs ─────────────────────────────────────────
  // Keyed by IncidentType (packages/shared/src/types/index.ts).
  // Flood — double wave
  incident_flood: `<path d="M4 16c3 3 5 3 8 0s5-3 8 0 5 3 8 0 5-3 8 0" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M4 26c3 3 5 3 8 0s5-3 8 0 5 3 8 0 5-3 8 0" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M4 36c3 3 5 3 8 0s5-3 8 0 5 3 8 0 5-3 8 0" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/>`,
  // Mudslide — downward angled flow of dots
  incident_mudslide: `<path d="M6 10l36 28" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><circle cx="14" cy="18" r="2.5" fill="white"/><circle cx="24" cy="26" r="2.5" fill="white"/><circle cx="34" cy="34" r="2.5" fill="white"/>`,
  // Landslide — mountain slope with sliding rocks
  incident_landslide: `<path d="M4 40l18-28 10 15 12-7v20z" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/><circle cx="28" cy="30" r="2" fill="white"/><circle cx="34" cy="36" r="2" fill="white"/>`,
  // Road blocked — traffic cone + stripes
  incident_road_blocked: `<path d="M18 42l6-28 6 28z" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/><path d="M6 42h36" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M19 30h10M20 24h8" stroke="white" stroke-width="3" stroke-linecap="round"/>`,
  // Building damaged — house with cracked wall
  incident_building_damaged: `<path d="M6 22l18-14 18 14v20H6z" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/><path d="M22 22l-4 8 6 3-4 9" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  // Power out — lightning with slash
  incident_power_out: `<path d="M26 4L12 26h10l-4 18 18-22H26l4-18z" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/><path d="M6 6l36 36" stroke="white" stroke-width="4" stroke-linecap="round"/>`,
  // Water contaminated — droplet with X
  incident_water_contaminated: `<path d="M24 6l-10 16a10 10 0 0020 0L24 6z" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/><path d="M19 18l10 10M29 18l-10 10" stroke="white" stroke-width="3" stroke-linecap="round"/>`,
};

function makeSvg(path: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${SIZE}" height="${SIZE}">${path}</svg>`;
}

async function svgToImageData(svg: string): Promise<ImageData> {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    return ctx.getImageData(0, 0, SIZE, SIZE);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Loads all category glyphs + the SOS glyph into the map's image
 * registry as SDF icons. Call once when the map is ready. Prefixes
 * every id with `kunak-icon-` to avoid collisions with style sprites. */
export async function loadMarkerSprites(map: MapLibreMap): Promise<void> {
  await Promise.all(
    Object.entries(ICONS).map(async ([key, path]) => {
      const id = `kunak-icon-${key}`;
      if (map.hasImage(id)) return;
      const imageData = await svgToImageData(makeSvg(path));
      map.addImage(id, imageData, { sdf: true });
    }),
  );
}
