// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import path from "node:path";
import express from "express";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── OpenMapTiles-compatible style for MapLibre GL JS ───────────────────────
// Minimal "positron"-like style: background, water, roads, buildings, labels

function buildStyleJSON(baseUrl: string) {
  const tileUrl = `${baseUrl}/api/v1/tiles/{z}/{x}/{y}.pbf`;

  return {
    version: 8,
    name: "Samur",
    sources: {
      openmaptiles: {
        type: "vector",
        tiles: [tileUrl],
        maxzoom: 14,
        attribution: "",
      },
    },
    glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    layers: [
      // Background
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#f8f4f0" },
      },
      // Water
      {
        id: "water",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "water",
        paint: { "fill-color": "#a0c8f0" },
      },
      // Landcover (parks, forests)
      {
        id: "landcover-grass",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        filter: ["==", "class", "grass"],
        paint: { "fill-color": "#d8e8c8", "fill-opacity": 0.6 },
      },
      {
        id: "landcover-wood",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        filter: ["==", "class", "wood"],
        paint: { "fill-color": "#b8d8a8", "fill-opacity": 0.5 },
      },
      // Landuse
      {
        id: "landuse-residential",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landuse",
        filter: ["==", "class", "residential"],
        paint: { "fill-color": "#ede7e3", "fill-opacity": 0.5 },
      },
      // Buildings
      {
        id: "building",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: 13,
        paint: {
          "fill-color": "#d9d0c9",
          "fill-opacity": 0.7,
          "fill-outline-color": "#c9c0b9",
        },
      },
      // Roads — minor
      {
        id: "road-minor",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["all", ["==", "$type", "LineString"], ["in", "class", "minor", "service"]],
        paint: {
          "line-color": "#fff",
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 18, 6],
        },
      },
      // Roads — secondary
      {
        id: "road-secondary",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["all", ["==", "$type", "LineString"], ["in", "class", "secondary", "tertiary"]],
        paint: {
          "line-color": "#fefce8",
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 18, 10],
        },
      },
      // Roads — primary
      {
        id: "road-primary",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["all", ["==", "$type", "LineString"], ["==", "class", "primary"]],
        paint: {
          "line-color": "#fef3c7",
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 18, 14],
        },
      },
      // Roads — motorway/trunk
      {
        id: "road-motorway",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["all", ["==", "$type", "LineString"], ["in", "class", "motorway", "trunk"]],
        paint: {
          "line-color": "#fcd34d",
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 18, 16],
        },
      },
      // Waterway lines
      {
        id: "waterway",
        type: "line",
        source: "openmaptiles",
        "source-layer": "waterway",
        paint: {
          "line-color": "#a0c8f0",
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 14, 3],
        },
      },
      // Boundaries
      {
        id: "boundary-country",
        type: "line",
        source: "openmaptiles",
        "source-layer": "boundary",
        filter: ["==", "admin_level", 2],
        paint: { "line-color": "#9ca3af", "line-width": 1.5, "line-dasharray": [3, 2] },
      },
      // Place labels — cities/towns
      {
        id: "place-city",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        filter: ["in", "class", "city", "town"],
        layout: {
          "text-field": "{name:latin}\n{name:nonlatin}",
          "text-font": ["Open Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 6, 10, 14, 18],
          "text-anchor": "center",
          "text-max-width": 8,
        },
        paint: {
          "text-color": "#333",
          "text-halo-color": "#fff",
          "text-halo-width": 1.5,
        },
      },
      // Place labels — villages
      {
        id: "place-village",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        filter: ["==", "class", "village"],
        minzoom: 10,
        layout: {
          "text-field": "{name:latin}\n{name:nonlatin}",
          "text-font": ["Open Sans Regular"],
          "text-size": 12,
          "text-anchor": "center",
          "text-max-width": 6,
        },
        paint: {
          "text-color": "#555",
          "text-halo-color": "#fff",
          "text-halo-width": 1.2,
        },
      },
    ],
  };
}

// ── Style endpoint ─────────────────────────────────────────────────────────

router.get("/style.json", (req, res) => {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const baseUrl = `${proto}://${host}`;

  res.set("Cache-Control", "public, max-age=3600");
  res.json(buildStyleJSON(baseUrl));
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
    res.set("Content-Encoding", upstream.headers.get("content-encoding") ?? "");

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
