// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { Incident, HelpRequest, Shelter, RiverLevel } from "@samur/shared";
import {
  MAKHACHKALA_CENTER,
  INCIDENT_TYPE_LABELS,
  SEVERITY_LABELS,
  HELP_CATEGORY_LABELS,
  SHELTER_STATUS_LABELS,
  RIVER_TREND_LABELS,
  AMENITY_LABELS,
} from "@samur/shared";
import { formatRelativeTime } from "@samur/shared";
import { incidentIcons, helpNeedIcon, helpOfferIcon, getShelterIcon, getRiverIcon } from "./MarkerIcons.js";
import { UrgencyBadge } from "../UrgencyBadge.js";

import "leaflet.markercluster";

interface Props {
  incidents: Incident[];
  helpRequests: HelpRequest[];
  shelters: Shelter[];
  riverLevels: RiverLevel[];
  layers: Record<string, boolean>;
  onMarkerClick: (type: string, item: unknown) => void;
  onMapMove?: (bounds: { north: number; south: number; east: number; west: number }, zoom: number) => void;
}

export function MapView({
  incidents,
  helpRequests,
  shelters,
  riverLevels,
  layers,
  onMarkerClick,
  onMapMove,
}: Props) {
  return (
    <MapContainer
      center={[MAKHACHKALA_CENTER.lat, MAKHACHKALA_CENTER.lng]}
      zoom={11}
      className="map-container"
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapEventHandler onMapMove={onMapMove} />

      {layers.incidents && (
        <ClusteredLayer>
          {incidents.map((inc) => (
            <Marker
              key={inc.id}
              position={[inc.lat, inc.lng]}
              icon={incidentIcons[inc.severity] ?? incidentIcons.low}
              eventHandlers={{ click: () => onMarkerClick("incident", inc) }}
            >
              <Popup>
                <div className="popup-content">
                  <strong>{INCIDENT_TYPE_LABELS[inc.type] ?? inc.type}</strong>
                  <UrgencyBadge value={inc.severity} kind="severity" />
                  <p>{inc.description ?? "Нет описания"}</p>
                  <small>{formatRelativeTime(inc.createdAt)}</small>
                </div>
              </Popup>
            </Marker>
          ))}
        </ClusteredLayer>
      )}

      {layers.helpRequests && (
        <ClusteredLayer>
          {helpRequests.map((hr) => (
            <Marker
              key={hr.id}
              position={[hr.lat, hr.lng]}
              icon={hr.type === "offer" ? helpOfferIcon : helpNeedIcon}
              eventHandlers={{ click: () => onMarkerClick("helpRequest", hr) }}
            >
              <Popup>
                <div className="popup-content">
                  <strong>{HELP_CATEGORY_LABELS[hr.category] ?? hr.category}</strong>
                  <UrgencyBadge value={hr.urgency} kind="urgency" />
                  <p>{hr.description ?? "Нет описания"}</p>
                  <small>{formatRelativeTime(hr.createdAt)}</small>
                </div>
              </Popup>
            </Marker>
          ))}
        </ClusteredLayer>
      )}

      {layers.shelters &&
        shelters.map((s) => (
          <Marker
            key={s.id}
            position={[s.lat, s.lng]}
            icon={getShelterIcon(s.status)}
            eventHandlers={{ click: () => onMarkerClick("shelter", s) }}
          >
            <Popup>
              <div className="popup-content">
                <strong>{s.name}</strong>
                <span className="popup-status">{SHELTER_STATUS_LABELS[s.status]}</span>
                <p>{s.address}</p>
                <p>Мест: {s.currentOccupancy}/{s.capacity}</p>
                {s.amenities.length > 0 && (
                  <p>{s.amenities.map((a) => AMENITY_LABELS[a] ?? a).join(", ")}</p>
                )}
              </div>
            </Popup>
          </Marker>
        ))}

      {layers.riverLevels &&
        riverLevels.map((r) => (
          <Marker
            key={r.id}
            position={[r.lat, r.lng]}
            icon={getRiverIcon(r.levelCm, r.dangerLevelCm)}
            eventHandlers={{ click: () => onMarkerClick("riverLevel", r) }}
          >
            <Popup>
              <div className="popup-content">
                <strong>{r.riverName} — {r.stationName}</strong>
                <p>
                  Уровень: {r.levelCm} см / {r.dangerLevelCm} см (опасный)
                </p>
                <p>Тренд: {RIVER_TREND_LABELS[r.trend]}</p>
                <small>{formatRelativeTime(r.measuredAt)}</small>
              </div>
            </Popup>
          </Marker>
        ))}
    </MapContainer>
  );
}

function MapEventHandler({
  onMapMove,
}: {
  onMapMove?: (bounds: { north: number; south: number; east: number; west: number }, zoom: number) => void;
}) {
  useMapEvents({
    moveend(e) {
      if (!onMapMove) return;
      const map = e.target;
      const b = map.getBounds();
      onMapMove(
        {
          north: b.getNorth(),
          south: b.getSouth(),
          east: b.getEast(),
          west: b.getWest(),
        },
        map.getZoom(),
      );
    },
  });
  return null;
}

function ClusteredLayer({ children }: { children: React.ReactNode }) {
  const map = useMap();
  const groupRef = useRef<L.MarkerClusterGroup | null>(null);

  useEffect(() => {
    if (!groupRef.current) {
      groupRef.current = L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
      });
      map.addLayer(groupRef.current);
    }

    return () => {
      if (groupRef.current) {
        map.removeLayer(groupRef.current);
        groupRef.current = null;
      }
    };
  }, [map]);

  // We don't render children through react-leaflet's cluster —
  // instead we manually manage markers for performance
  return <>{children}</>;
}
