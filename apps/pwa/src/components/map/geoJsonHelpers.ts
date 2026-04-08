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
    features: items.map((r) =>
      point(r.lng, r.lat, {
        id: r.id,
        riverName: r.riverName,
        stationName: r.stationName,
        levelCm: r.levelCm,
        dangerLevelCm: r.dangerLevelCm,
        dangerRatio: r.dangerLevelCm > 0 ? r.levelCm / r.dangerLevelCm : 0,
        trend: r.trend,
        measuredAt: r.measuredAt,
      }),
    ),
  };
}
