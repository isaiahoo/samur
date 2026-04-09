// SPDX-License-Identifier: AGPL-3.0-only
import type { Incident, HelpRequest, Shelter, RiverLevel } from "@samur/shared";

type Feature = GeoJSON.Feature<GeoJSON.Point>;
type FeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Point>;

function point(lng: number, lat: number, properties: Record<string, unknown>): Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties,
  };
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
      }),
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
      }),
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
      }),
    ),
  };
}

export function toRiverLevelsGeoJSON(items: RiverLevel[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: items.map((r) => {
      // Compute danger ratio from cm or discharge (relative to mean)
      let dangerRatio = 0;
      if (r.levelCm !== null && r.dangerLevelCm && r.dangerLevelCm > 0) {
        dangerRatio = r.levelCm / r.dangerLevelCm;
      } else if (r.dischargeCubicM !== null && r.dischargeMean && r.dischargeMean > 0) {
        // Map to 0-1 scale: 1x mean = 0.33, 2x mean = 0.66, 3x mean = 1.0
        dangerRatio = (r.dischargeCubicM / r.dischargeMean) / 3;
      }

      // Heatmap weight: 0-1 based on discharge/mean ratio (capped at 4x)
      let heatWeight = 0;
      if (r.dischargeCubicM !== null && r.dischargeCubicM > 0 && r.dischargeMean && r.dischargeMean > 0) {
        heatWeight = Math.min((r.dischargeCubicM / r.dischargeMean) / 4, 1.0);
      } else if (r.levelCm !== null && r.levelCm > 0 && r.dangerLevelCm && r.dangerLevelCm > 0) {
        heatWeight = Math.min(r.levelCm / r.dangerLevelCm, 1.0);
      }

      return point(r.lng, r.lat, {
        id: r.id,
        riverName: r.riverName,
        stationName: r.stationName,
        levelCm: r.levelCm,
        dangerLevelCm: r.dangerLevelCm,
        dischargeCubicM: r.dischargeCubicM,
        dischargeMean: r.dischargeMean,
        dischargeMax: r.dischargeMax,
        dataSource: r.dataSource,
        dangerRatio,
        heatWeight,
        trend: r.trend,
        measuredAt: r.measuredAt,
      });
    }),
  };
}

/** GeoJSON for precipitation grid heatmap */
export interface PrecipitationPoint {
  lat: number;
  lng: number;
  precipitation: number; // mm/h or mm total
}

export function toPrecipitationGeoJSON(points: PrecipitationPoint[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points
      .filter((p) => p.precipitation > 0)
      .map((p) =>
        point(p.lng, p.lat, {
          precipitation: p.precipitation,
          // Normalize: 0-1 scale, 50mm+ = max intensity
          intensity: Math.min(p.precipitation / 50, 1.0),
        }),
      ),
  };
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
