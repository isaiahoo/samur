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
        trend: r.trend,
        measuredAt: r.measuredAt,
      });
    }),
  };
}
