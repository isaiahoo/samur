// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import path from "node:path";
import express from "express";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Cached MapTiler style (fetched once, rewritten to use our tile proxy) ──

let cachedStyle: Record<string, unknown> | null = null;
let cacheTime = 0;
const STYLE_CACHE_MS = 3600_000; // 1 hour

async function fetchAndRewriteStyle(baseUrl: string): Promise<Record<string, unknown>> {
  const now = Date.now();
  if (cachedStyle && now - cacheTime < STYLE_CACHE_MS) {
    // Deep clone and rewrite baseUrl each time (it may vary by request)
    return rewriteUrls(JSON.parse(JSON.stringify(cachedStyle)), baseUrl);
  }

  let style: Record<string, unknown>;

  if (config.TILE_PROVIDER === "maptiler" && config.MAPTILER_API_KEY) {
    const res = await fetch(
      `https://api.maptiler.com/maps/streets-v2/style.json?key=${config.MAPTILER_API_KEY}`,
    );
    if (!res.ok) throw new Error(`MapTiler style fetch failed: ${res.status}`);
    style = (await res.json()) as Record<string, unknown>;
  } else {
    // OpenFreeMap fallback: use a minimal self-built style
    style = buildFallbackStyle(baseUrl);
    cachedStyle = JSON.parse(JSON.stringify(style));
    cacheTime = now;
    return style;
  }

  cachedStyle = JSON.parse(JSON.stringify(style));
  cacheTime = now;
  return rewriteUrls(style, baseUrl);
}

// Rewrite MapTiler URLs to go through our proxy (keeps API key server-side)
// and switch labels from English to Russian
function rewriteUrls(style: Record<string, unknown>, baseUrl: string): Record<string, unknown> {
  const proxyTileUrl = `${baseUrl}/api/v1/tiles/{z}/{x}/{y}.pbf`;

  // Rewrite tile source URLs
  const sources = style.sources as Record<string, Record<string, unknown>> | undefined;
  if (sources) {
    for (const src of Object.values(sources)) {
      if (src.url && typeof src.url === "string" && src.url.includes("maptiler.com")) {
        // Resolve tiles.json into inline tile URL so we control maxzoom
        delete src.url;
        src.tiles = [proxyTileUrl];
      } else if (src.tiles && Array.isArray(src.tiles)) {
        src.tiles = src.tiles.map((t: string) =>
          t.includes("maptiler.com") ? proxyTileUrl : t,
        );
      }
    }
  }

  // Rewrite labels from English to Russian
  rewriteLabelsToRussian(style);

  return style;
}

// Recursively replace "name:en" → "name:ru" in all text-field expressions
// so map labels appear in Russian (Cyrillic) instead of Latin
function rewriteLabelsToRussian(obj: unknown): void {
  if (typeof obj === "string") return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === "string") {
        obj[i] = obj[i].replace(/name:en/g, "name:ru").replace(/\{name:en\}/g, "{name:ru}");
      } else {
        rewriteLabelsToRussian(obj[i]);
      }
    }
    return;
  }
  if (obj && typeof obj === "object") {
    const rec = obj as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      if (typeof rec[key] === "string") {
        rec[key] = (rec[key] as string).replace(/name:en/g, "name:ru").replace(/\{name:en\}/g, "{name:ru}");
      } else {
        rewriteLabelsToRussian(rec[key]);
      }
    }
  }
}

// Minimal fallback style for OpenFreeMap (no MapTiler key)
function buildFallbackStyle(baseUrl: string): Record<string, unknown> {
  const tileUrl = `${baseUrl}/api/v1/tiles/{z}/{x}/{y}.pbf`;
  return {
    version: 8,
    name: "Samur",
    sources: {
      openmaptiles: { type: "vector", tiles: [tileUrl], maxzoom: 14, attribution: "" },
    },
    glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#f8f4f0" } },
      { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": "#a0c8f0" } },
      { id: "landcover-grass", type: "fill", source: "openmaptiles", "source-layer": "landcover", filter: ["==", "class", "grass"], paint: { "fill-color": "#d8e8c8", "fill-opacity": 0.6 } },
      { id: "landcover-wood", type: "fill", source: "openmaptiles", "source-layer": "landcover", filter: ["==", "class", "wood"], paint: { "fill-color": "#b8d8a8", "fill-opacity": 0.5 } },
      { id: "landuse-residential", type: "fill", source: "openmaptiles", "source-layer": "landuse", filter: ["==", "class", "residential"], paint: { "fill-color": "#ede7e3", "fill-opacity": 0.5 } },
      { id: "building", type: "fill", source: "openmaptiles", "source-layer": "building", minzoom: 13, paint: { "fill-color": "#d9d0c9", "fill-opacity": 0.7, "fill-outline-color": "#c9c0b9" } },
      { id: "road-minor", type: "line", source: "openmaptiles", "source-layer": "transportation", filter: ["all", ["==", "$type", "LineString"], ["in", "class", "minor", "service"]], paint: { "line-color": "#fff", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 18, 6] } },
      { id: "road-secondary", type: "line", source: "openmaptiles", "source-layer": "transportation", filter: ["all", ["==", "$type", "LineString"], ["in", "class", "secondary", "tertiary"]], paint: { "line-color": "#fefce8", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 18, 10] } },
      { id: "road-primary", type: "line", source: "openmaptiles", "source-layer": "transportation", filter: ["all", ["==", "$type", "LineString"], ["==", "class", "primary"]], paint: { "line-color": "#fef3c7", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 18, 14] } },
      { id: "road-motorway", type: "line", source: "openmaptiles", "source-layer": "transportation", filter: ["all", ["==", "$type", "LineString"], ["in", "class", "motorway", "trunk"]], paint: { "line-color": "#fcd34d", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 18, 16] } },
      { id: "waterway", type: "line", source: "openmaptiles", "source-layer": "waterway", paint: { "line-color": "#a0c8f0", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 14, 3] } },
      { id: "boundary-country", type: "line", source: "openmaptiles", "source-layer": "boundary", filter: ["==", "admin_level", 2], paint: { "line-color": "#9ca3af", "line-width": 1.5, "line-dasharray": [3, 2] } },
      { id: "place-city", type: "symbol", source: "openmaptiles", "source-layer": "place", filter: ["in", "class", "city", "town"], layout: { "text-field": "{name:latin}\n{name:nonlatin}", "text-font": ["Open Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 6, 10, 14, 18], "text-anchor": "center", "text-max-width": 8 }, paint: { "text-color": "#333", "text-halo-color": "#fff", "text-halo-width": 1.5 } },
      { id: "place-village", type: "symbol", source: "openmaptiles", "source-layer": "place", filter: ["==", "class", "village"], minzoom: 10, layout: { "text-field": "{name:latin}\n{name:nonlatin}", "text-font": ["Open Sans Regular"], "text-size": 12, "text-anchor": "center", "text-max-width": 6 }, paint: { "text-color": "#555", "text-halo-color": "#fff", "text-halo-width": 1.2 } },
    ],
  };
}

// ── Style endpoint ─────────────────────────────────────────────────────────

router.get("/style.json", async (req, res) => {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const baseUrl = `${proto}://${host}`;

  try {
    const style = await fetchAndRewriteStyle(baseUrl);
    res.set("Cache-Control", "public, max-age=3600");
    res.json(style);
  } catch (err) {
    logger.error({ err }, "Style fetch error");
    // Fall back to minimal style on error
    res.set("Cache-Control", "public, max-age=300");
    res.json(buildFallbackStyle(baseUrl));
  }
});

// ── Offline style endpoint (PMTiles source for when network is down) ──────

router.get("/offline-style.json", (_req, res) => {
  const pmtilesUrl = "pmtiles:///api/v1/tiles/offline/dagestan.pmtiles";
  res.set("Cache-Control", "public, max-age=86400");
  res.json({
    version: 8,
    name: "Samur Offline",
    sources: {
      openmaptiles: {
        type: "vector",
        url: pmtilesUrl,
        attribution: "",
      },
    },
    glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#f8f4f0" } },
      { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": "#a0c8f0" } },
      { id: "landcover-grass", type: "fill", source: "openmaptiles", "source-layer": "landcover", filter: ["==", "class", "grass"], paint: { "fill-color": "#d8e8c8", "fill-opacity": 0.6 } },
      { id: "landcover-wood", type: "fill", source: "openmaptiles", "source-layer": "landcover", filter: ["==", "class", "wood"], paint: { "fill-color": "#b8d8a8", "fill-opacity": 0.5 } },
      { id: "landuse-residential", type: "fill", source: "openmaptiles", "source-layer": "landuse", filter: ["==", "class", "residential"], paint: { "fill-color": "#ede7e3", "fill-opacity": 0.5 } },
      { id: "building", type: "fill", source: "openmaptiles", "source-layer": "building", minzoom: 13, paint: { "fill-color": "#d9d0c9", "fill-opacity": 0.7, "fill-outline-color": "#c9c0b9" } },
      { id: "road-minor", type: "line", source: "openmaptiles", "source-layer": "transportation", filter: ["all", ["==", "$type", "LineString"], ["in", "class", "minor", "service"]], paint: { "line-color": "#fff", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 18, 6] } },
      { id: "road-secondary", type: "line", source: "openmaptiles", "source-layer": "transportation", filter: ["all", ["==", "$type", "LineString"], ["in", "class", "secondary", "tertiary"]], paint: { "line-color": "#fefce8", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 18, 10] } },
      { id: "road-primary", type: "line", source: "openmaptiles", "source-layer": "transportation", filter: ["all", ["==", "$type", "LineString"], ["==", "class", "primary"]], paint: { "line-color": "#fef3c7", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 18, 14] } },
      { id: "road-motorway", type: "line", source: "openmaptiles", "source-layer": "transportation", filter: ["all", ["==", "$type", "LineString"], ["in", "class", "motorway", "trunk"]], paint: { "line-color": "#fcd34d", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 18, 16] } },
      { id: "waterway", type: "line", source: "openmaptiles", "source-layer": "waterway", paint: { "line-color": "#a0c8f0", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 14, 3] } },
      { id: "boundary-country", type: "line", source: "openmaptiles", "source-layer": "boundary", filter: ["==", "admin_level", 2], paint: { "line-color": "#9ca3af", "line-width": 1.5, "line-dasharray": [3, 2] } },
      { id: "place-city", type: "symbol", source: "openmaptiles", "source-layer": "place", filter: ["in", "class", "city", "town"], layout: { "text-field": "{name}\n{name:latin}", "text-font": ["Open Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 6, 10, 14, 18], "text-anchor": "center", "text-max-width": 8 }, paint: { "text-color": "#333", "text-halo-color": "#fff", "text-halo-width": 1.5 } },
      { id: "place-village", type: "symbol", source: "openmaptiles", "source-layer": "place", filter: ["==", "class", "village"], minzoom: 10, layout: { "text-field": "{name}", "text-font": ["Open Sans Regular"], "text-size": 12, "text-anchor": "center", "text-max-width": 6 }, paint: { "text-color": "#555", "text-halo-color": "#fff", "text-halo-width": 1.2 } },
    ],
  });
});

// ── Tile proxy endpoint ────────────────────────────────────────────────────
// Proxies vector tile requests to MapTiler or OpenFreeMap
// API key stays server-side — never exposed to frontend

router.get("/:z/:x/:y.pbf", async (req, res) => {
  const { z, x, y } = req.params;

  let upstreamUrl: string;

  if (config.TILE_PROVIDER === "maptiler" && config.MAPTILER_API_KEY) {
    upstreamUrl = `https://api.maptiler.com/tiles/v3/${z}/${x}/${y}.pbf?key=${config.MAPTILER_API_KEY}`;
  } else {
    // Default: OpenFreeMap (free, no API key)
    upstreamUrl = `https://tiles.openfreemap.org/planet/${z}/${x}/${y}.pbf`;
  }

  try {
    const upstream = await fetch(upstreamUrl);

    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }

    res.set("Content-Type", "application/x-protobuf");
    res.set("Cache-Control", "public, max-age=86400"); // 1 day
    // Note: do NOT forward Content-Encoding — Node fetch auto-decompresses

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    logger.error({ err, z, x, y }, "Tile proxy error");
    res.status(502).end();
  }
});

// ── PMTiles static serving (offline tile file) ─────────────────────────────
// Serves /api/v1/tiles/offline/* from the tiles directory
// Supports range requests (required by PMTiles protocol)

const tilesDir = path.resolve(process.cwd(), "tiles");
router.use("/offline", express.static(tilesDir, {
  setHeaders(res) {
    res.set("Accept-Ranges", "bytes");
    res.set("Cache-Control", "public, max-age=604800"); // 7 days
    res.set("Access-Control-Allow-Origin", "*");
  },
}));

export default router;
