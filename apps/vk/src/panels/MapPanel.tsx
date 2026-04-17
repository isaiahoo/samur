// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useRef } from "react";
import {
  Panel,
  PanelHeader,
  Button,
  ScreenSpinner,
} from "@vkontakte/vkui";
import maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { getIncidents, getShelters, getHelpRequests } from "../services/api";
import { getGeodata } from "../services/vkbridge";
import { INCIDENT_COLORS, HELP_COLORS, SHELTER_COLORS } from "../components/MarkerIcons";
import {
  INCIDENT_TYPE_LABELS,
  SEVERITY_LABELS,
  HELP_CATEGORY_LABELS,
  SHELTER_STATUS_LABELS,
  MAKHACHKALA_CENTER,
} from "@samur/shared";
import type { Incident, HelpRequest, Shelter } from "@samur/shared";
import type { PanelId } from "../hooks/useNav";

interface Props {
  id: string;
  go: (panel: PanelId) => void;
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toGeoJSON<T extends { lat: number; lng: number }>(
  items: T[],
  mapper: (item: T) => Record<string, unknown>,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: items.map((item) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [item.lng, item.lat] },
      properties: mapper(item),
    })),
  };
}

export default function MapPanel({ id, go }: Props) {
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "/api/v1/tiles/style.json",
      center: [MAKHACHKALA_CENTER.lng, MAKHACHKALA_CENTER.lat],
      zoom: 11,
      attributionControl: false,
    });

    const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "240px" });

    map.on("load", async () => {
      // Try VK geodata for center
      const geo = await getGeodata();
      if (geo) map.setCenter([geo.long, geo.lat]);

      // Add sources
      map.addSource("incidents", { type: "geojson", data: EMPTY_FC });
      map.addSource("helpRequests", { type: "geojson", data: EMPTY_FC });
      map.addSource("shelters", { type: "geojson", data: EMPTY_FC });

      // Incident layer
      map.addLayer({
        id: "incidents",
        type: "circle",
        source: "incidents",
        paint: {
          "circle-color": [
            "match", ["get", "severity"],
            "critical", INCIDENT_COLORS.critical,
            "high", INCIDENT_COLORS.high,
            "medium", INCIDENT_COLORS.medium,
            "low", INCIDENT_COLORS.low,
            INCIDENT_COLORS.low,
          ],
          "circle-radius": 7,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });

      // Help requests layer
      map.addLayer({
        id: "helpRequests",
        type: "circle",
        source: "helpRequests",
        paint: {
          "circle-color": [
            "match", ["get", "type"],
            "need", HELP_COLORS.need,
            "offer", HELP_COLORS.offer,
            HELP_COLORS.need,
          ],
          "circle-radius": 7,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });

      // Shelters layer
      map.addLayer({
        id: "shelters",
        type: "circle",
        source: "shelters",
        paint: {
          "circle-color": [
            "match", ["get", "status"],
            "open", SHELTER_COLORS.open,
            "full", SHELTER_COLORS.full,
            SHELTER_COLORS.full,
          ],
          "circle-radius": 8,
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#fff",
        },
      });

      // Load data
      try {
        const [inc, hr, sh] = await Promise.all([
          getIncidents("limit=100&status=verified&status=unverified"),
          getHelpRequests("limit=100&status=open"),
          getShelters(),
        ]);

        (map.getSource("incidents") as GeoJSONSource).setData(
          toGeoJSON(inc, (i: Incident) => ({
            type: i.type,
            severity: i.severity,
            description: i.description ?? "",
          })),
        );

        (map.getSource("helpRequests") as GeoJSONSource).setData(
          toGeoJSON(hr, (h: HelpRequest) => ({
            type: h.type,
            category: h.category,
            description: h.description ?? "",
            contactPhone: h.contactPhone ?? "",
          })),
        );

        (map.getSource("shelters") as GeoJSONSource).setData(
          toGeoJSON(sh, (s: Shelter) => ({
            name: s.name,
            address: s.address,
            status: s.status,
            currentOccupancy: s.currentOccupancy,
            capacity: s.capacity,
            contactPhone: s.contactPhone ?? "",
          })),
        );
      } catch (err) {
        console.error("Failed to load map data:", err);
      }
      setLoading(false);
    });

    // Click handlers with popups
    const interactiveLayers = ["incidents", "helpRequests", "shelters"];
    for (const layer of interactiveLayers) {
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    }

    map.on("click", "incidents", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties;
      const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
      const typeLabel = INCIDENT_TYPE_LABELS[p.type as string] ?? p.type;
      const sevLabel = SEVERITY_LABELS[p.severity as string] ?? p.severity;
      popup.setLngLat(coords).setHTML(
        `<strong>${escapeHtml(typeLabel)}</strong><br/>${escapeHtml(sevLabel)}${p.description ? `<br/>${escapeHtml(String(p.description))}` : ""}`,
      ).addTo(map);
    });

    map.on("click", "helpRequests", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties;
      const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
      const catLabel = HELP_CATEGORY_LABELS[p.category as string] ?? p.category;
      const typeLabel = p.type === "need" ? "Нужна помощь" : "Предложение помощи";
      popup.setLngLat(coords).setHTML(
        `<strong>${escapeHtml(catLabel)}</strong><br/>${escapeHtml(typeLabel)}${p.description ? `<br/>${escapeHtml(String(p.description))}` : ""}${p.contactPhone ? `<br/>📞 ${escapeHtml(String(p.contactPhone))}` : ""}`,
      ).addTo(map);
    });

    map.on("click", "shelters", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties;
      const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
      const statusLabel = SHELTER_STATUS_LABELS[p.status as string] ?? p.status;
      popup.setLngLat(coords).setHTML(
        `<strong>${escapeHtml(String(p.name))}</strong><br/>${escapeHtml(String(p.address))}<br/>👥 ${Number(p.currentOccupancy)}/${Number(p.capacity)} — ${escapeHtml(statusLabel)}${p.contactPhone ? `<br/>📞 ${escapeHtml(String(p.contactPhone))}` : ""}`,
      ).addTo(map);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <Panel id={id}>
      <PanelHeader>Кунак — Карта</PanelHeader>
      <div style={{ position: "relative", height: "calc(100vh - 96px)" }}>
        {loading && <ScreenSpinner />}
        <div ref={containerRef} style={{ height: "100%", width: "100%" }} />

        <div
          style={{
            position: "absolute",
            bottom: 16,
            right: 16,
            zIndex: 1000,
          }}
        >
          <Button
            size="l"
            mode="primary"
            onClick={() => go("report")}
            style={{ borderRadius: "50%", width: 56, height: 56, padding: 0 }}
          >
            📍
          </Button>
        </div>
      </div>
    </Panel>
  );
}
