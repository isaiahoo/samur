// SPDX-License-Identifier: AGPL-3.0-only
import type { Incident, HelpRequest, Shelter } from "@samur/shared";

type Feature = GeoJSON.Feature<GeoJSON.Point>;
type FeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Point>;

function point(lng: number, lat: number, properties: Record<string, unknown>, id?: string): Feature {
  const f: Feature = {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties,
  };
  if (id) f.id = id;
  return f;
}

export function toIncidentsGeoJSON(items: Incident[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: items.map((inc) =>
      point(inc.lng, inc.lat, {
        id: inc.id,
        type: inc.type,
        severity: inc.severity,
        status: inc.status,
        description: inc.description ?? "",
        address: inc.address ?? "",
        createdAt: inc.createdAt,
      }, inc.id),
    ),
  };
}

export function toHelpRequestsGeoJSON(items: HelpRequest[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: items.map((hr) =>
      point(hr.lng, hr.lat, {
        id: hr.id,
        type: hr.type,
        category: hr.category,
        urgency: hr.urgency,
        description: hr.description ?? "",
        address: hr.address ?? "",
        contactPhone: hr.contactPhone ?? "",
        contactName: hr.contactName ?? "",
        createdAt: hr.createdAt,
      }, hr.id),
    ),
  };
}

export function toSheltersGeoJSON(items: Shelter[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: items.map((s) =>
      point(s.lng, s.lat, {
        id: s.id,
        name: s.name,
        address: s.address,
        capacity: s.capacity,
        currentOccupancy: s.currentOccupancy,
        status: s.status,
        contactPhone: s.contactPhone ?? "",
        amenities: s.amenities.join(","),
      }, s.id),
    ),
  };
}

/** GeoJSON for precipitation grid */
export interface PrecipitationPoint {
  lat: number;
  lng: number;
  precipitation: number; // mm/24h total
  peakHourlyMm?: number; // max single-hour precipitation
}

/** GeoJSON for soil moisture grid heatmap */
export interface SoilMoisturePoint {
  lat: number;
  lng: number;
  moisture: number; // m³/m³ volumetric water content (0.1–0.5)
}

export function toSoilMoistureGeoJSON(points: SoilMoisturePoint[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points
      .filter((p) => p.moisture > 0.10)
      .map((p) =>
        point(p.lng, p.lat, {
          moisture: p.moisture,
          // Normalize: 0.10–0.45 → 0–1 scale (aggressive — even "normal" moisture shows)
          intensity: Math.min(Math.max((p.moisture - 0.10) / 0.35, 0.05), 1.0),
        }),
      ),
  };
}

/** Surface runoff risk point (SCS-CN derived) */
export interface RunoffPoint {
  lat: number;
  lng: number;
  runoffDepth: number;       // mm
  riskIndex: number;         // 0–100
  riskLevel: string;         // "low" | "moderate" | "high" | "extreme"
  precipitation24h: number;  // mm — input evidence
  soilMoisture: number;      // m³/m³ — input evidence
}

/** Snow data point from the mountain grid */
export interface SnowForecastDay {
  date: string;
  snowDepthM: number;
  tempMaxC: number;
  tempMinC: number;
  snowfallCm: number;
  rainMm: number;
  meltIndex: number;
}

export interface SnowPoint {
  lat: number;
  lng: number;
  snowDepthM: number;     // meters
  temperatureC: number;   // °C
  snowfall24hCm: number;  // cm
  rain24hMm: number;      // mm
  meltIndex: number;      // mm water equiv/day
  forecast: SnowForecastDay[];
}
