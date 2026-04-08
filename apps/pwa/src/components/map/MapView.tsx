// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useCallback, memo } from "react";
import maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
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
import { INCIDENT_COLORS, HELP_COLORS, SHELTER_COLORS } from "./MarkerIcons.js";
import {
  toIncidentsGeoJSON,
  toHelpRequestsGeoJSON,
  toSheltersGeoJSON,
  toRiverLevelsGeoJSON,
} from "./geoJsonHelpers.js";

interface Props {
  incidents: Incident[];
  helpRequests: HelpRequest[];
  shelters: Shelter[];
  riverLevels: RiverLevel[];
  layers: Record<string, boolean>;
  onMarkerClick: (type: string, item: unknown) => void;
  onMapMove?: (bounds: { north: number; south: number; east: number; west: number }, zoom: number) => void;
}

// ── Empty GeoJSON to use as initial source data ────────────────────────────

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

// ── Popup HTML builders ────────────────────────────────────────────────────

function incidentPopupHTML(p: Record<string, unknown>): string {
  const type = INCIDENT_TYPE_LABELS[p.type as string] ?? p.type;
  const severity = SEVERITY_LABELS[p.severity as string] ?? p.severity;
  const desc = p.description || "Нет описания";
  const time = formatRelativeTime(p.createdAt as string);
  return `<div class="popup-content"><strong>${type}</strong><span class="popup-badge severity-${p.severity}">${severity}</span><p>${desc}</p><small>${time}</small></div>`;
}

function helpPopupHTML(p: Record<string, unknown>): string {
  const cat = HELP_CATEGORY_LABELS[p.category as string] ?? p.category;
  const typeLabel = p.type === "offer" ? "Предлагает помощь" : "Нужна помощь";
  const desc = p.description || "Нет описания";
  const time = formatRelativeTime(p.createdAt as string);
  return `<div class="popup-content"><strong>${cat}</strong><p>${typeLabel}</p><p>${desc}</p><small>${time}</small></div>`;
}

function shelterPopupHTML(p: Record<string, unknown>): string {
  const status = SHELTER_STATUS_LABELS[p.status as string] ?? p.status;
  const amenities = (p.amenities as string || "")
    .split(",")
    .filter(Boolean)
    .map((a) => AMENITY_LABELS[a] ?? a)
    .join(", ");
  return `<div class="popup-content"><strong>${p.name}</strong><span class="popup-status">${status}</span><p>${p.address}</p><p>Мест: ${p.currentOccupancy}/${p.capacity}</p>${amenities ? `<p>${amenities}</p>` : ""}</div>`;
}

function trendArrow(trend: string): string {
  switch (trend) {
    case "rising": return "↑";
    case "falling": return "↓";
    default: return "→";
  }
}

function staleWarning(measuredAt: string): string {
  const ageMs = Date.now() - new Date(measuredAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours > 6) return `<div class="popup-stale">⚠ Данные устарели (${Math.round(ageHours)}ч назад)</div>`;
  if (ageHours > 2) return `<div class="popup-stale-warn">Обновлено ${Math.round(ageHours)}ч назад</div>`;
  return "";
}

function riverPopupHTML(p: Record<string, unknown>): string {
  const trend = RIVER_TREND_LABELS[p.trend as string] ?? p.trend;
  const arrow = trendArrow(p.trend as string);
  const time = formatRelativeTime(p.measuredAt as string);
  const levelCm = Number(p.levelCm) || 0;
  const dangerCm = Number(p.dangerLevelCm) || 1;
  const pct = Math.round((levelCm / dangerCm) * 100);
  const barColor = pct >= 100 ? "#EF4444" : pct >= 80 ? "#F97316" : pct >= 60 ? "#F59E0B" : "#3B82F6";
  const stale = staleWarning(p.measuredAt as string);

  return `<div class="popup-content popup-river">
    <strong>${p.riverName} — ${p.stationName}</strong>
    ${stale}
    <div class="popup-river-bar"><div style="width:${Math.min(pct, 100)}%;background:${barColor}"></div></div>
    <p class="popup-river-level">${arrow} ${levelCm} / ${dangerCm} см (${pct}%)</p>
    <p>Тренд: ${trend}</p>
    <div class="popup-sparkline" data-river="${p.riverName}" data-station="${p.stationName}"></div>
    <small>${time}</small>
  </div>`;
}

// ── Component ──────────────────────────────────────────────────────────────

export const MapView = memo(function MapView({
  incidents,
  helpRequests,
  shelters,
  riverLevels,
  layers,
  onMarkerClick,
  onMapMove,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const readyRef = useRef(false);
  const offlineRef = useRef(false);

  // Store latest callbacks in refs to avoid re-initializing the map
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;
  const onMapMoveRef = useRef(onMapMove);
  onMapMoveRef.current = onMapMove;

  // ── Register PMTiles protocol for offline tile access ──────────────────

  useEffect(() => {
    const protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
    return () => { maplibregl.removeProtocol("pmtiles"); };
  }, []);

  // ── Initialize map ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "/api/v1/tiles/style.json",
      center: [MAKHACHKALA_CENTER.lng, MAKHACHKALA_CENTER.lat],
      zoom: 11,
      attributionControl: false,
    });

    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      "top-left",
    );

    popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "260px" });

    map.on("load", () => {
      // ── Sources ──────────────────────────────────────────────────────────

      map.addSource("incidents", {
        type: "geojson",
        data: EMPTY_FC,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      map.addSource("helpRequests", {
        type: "geojson",
        data: EMPTY_FC,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      map.addSource("shelters", { type: "geojson", data: EMPTY_FC });
      map.addSource("riverLevels", { type: "geojson", data: EMPTY_FC });

      // ── Incident layers ──────────────────────────────────────────────────

      map.addLayer({
        id: "incidents-clusters",
        type: "circle",
        source: "incidents",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#EF4444",
          "circle-radius": ["step", ["get", "point_count"], 18, 10, 24, 50, 32],
          "circle-opacity": 0.85,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });

      map.addLayer({
        id: "incidents-cluster-count",
        type: "symbol",
        source: "incidents",
        filter: ["has", "point_count"],
        layout: {
          "text-field": "{point_count_abbreviated}",
          "text-font": ["Open Sans Regular"],
          "text-size": 13,
        },
        paint: { "text-color": "#fff" },
      });

      map.addLayer({
        id: "incidents-unclustered",
        type: "circle",
        source: "incidents",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "match",
            ["get", "severity"],
            "critical", INCIDENT_COLORS.critical,
            "high", INCIDENT_COLORS.high,
            "medium", INCIDENT_COLORS.medium,
            "low", INCIDENT_COLORS.low,
            INCIDENT_COLORS.low,
          ],
          "circle-radius": 8,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });

      // ── Help request layers ──────────────────────────────────────────────

      map.addLayer({
        id: "help-clusters",
        type: "circle",
        source: "helpRequests",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#8B5CF6",
          "circle-radius": ["step", ["get", "point_count"], 18, 10, 24, 50, 32],
          "circle-opacity": 0.85,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });

      map.addLayer({
        id: "help-cluster-count",
        type: "symbol",
        source: "helpRequests",
        filter: ["has", "point_count"],
        layout: {
          "text-field": "{point_count_abbreviated}",
          "text-font": ["Open Sans Regular"],
          "text-size": 13,
        },
        paint: { "text-color": "#fff" },
      });

      map.addLayer({
        id: "help-unclustered",
        type: "circle",
        source: "helpRequests",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "match",
            ["get", "type"],
            "need", HELP_COLORS.need,
            "offer", HELP_COLORS.offer,
            HELP_COLORS.need,
          ],
          "circle-radius": 8,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });

      // ── Shelter layer ────────────────────────────────────────────────────

      map.addLayer({
        id: "shelters",
        type: "circle",
        source: "shelters",
        paint: {
          "circle-color": [
            "match",
            ["get", "status"],
            "open", SHELTER_COLORS.open,
            "full", SHELTER_COLORS.full,
            "closed", SHELTER_COLORS.closed,
            SHELTER_COLORS.full,
          ],
          "circle-radius": 9,
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#fff",
        },
      });

      // ── River level layer ────────────────────────────────────────────────

      map.addLayer({
        id: "rivers",
        type: "circle",
        source: "riverLevels",
        paint: {
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "dangerRatio"],
            0, "#3B82F6",
            0.6, "#F59E0B",
            0.8, "#F97316",
            1.0, "#EF4444",
          ],
          "circle-radius": 9,
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#fff",
        },
      });

      readyRef.current = true;
    });

    // ── Click handlers ───────────────────────────────────────────────────

    function handleClusterClick(sourceId: string) {
      return (e: maplibregl.MapLayerMouseEvent) => {
        const features = e.features;
        if (!features?.length) return;
        const clusterId = features[0].properties.cluster_id;
        (map.getSource(sourceId) as GeoJSONSource).getClusterExpansionZoom(clusterId).then((zoom) => {
          map.easeTo({
            center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number],
            zoom,
          });
        });
      };
    }

    map.on("click", "incidents-clusters", handleClusterClick("incidents"));
    map.on("click", "help-clusters", handleClusterClick("helpRequests"));

    function showPopup(layerId: string, builder: (p: Record<string, unknown>) => string, markerType: string) {
      map.on("click", layerId, (e: maplibregl.MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f) return;
        const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
        const props = f.properties as Record<string, unknown>;

        popupRef.current?.setLngLat(coords).setHTML(builder(props)).addTo(map);

        // Build a full object with lat/lng for the detail panel
        const item = { ...props, lat: coords[1], lng: coords[0] };
        onMarkerClickRef.current(markerType, item);
      });
    }

    showPopup("incidents-unclustered", incidentPopupHTML, "incident");
    showPopup("help-unclustered", helpPopupHTML, "helpRequest");
    showPopup("shelters", shelterPopupHTML, "shelter");
    showPopup("rivers", riverPopupHTML, "riverLevel");

    // Pointer cursor on interactive layers
    const interactiveLayers = [
      "incidents-clusters", "incidents-unclustered",
      "help-clusters", "help-unclustered",
      "shelters", "rivers",
    ];
    for (const layer of interactiveLayers) {
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    }

    // ── Bounds tracking ──────────────────────────────────────────────────

    map.on("moveend", () => {
      const b = map.getBounds();
      onMapMoveRef.current?.(
        { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() },
        map.getZoom(),
      );
    });

    // ── Offline ↔ Online style switching ───────────────────────────────────

    const ONLINE_STYLE = "/api/v1/tiles/style.json";
    const OFFLINE_STYLE = "/api/v1/tiles/offline-style.json";

    function switchToOffline() {
      if (offlineRef.current) return;
      offlineRef.current = true;
      // Fetch offline style (may come from service worker cache)
      fetch(OFFLINE_STYLE)
        .then((r) => r.json())
        .then((style) => { map.setStyle(style); })
        .catch(() => { /* no offline style available — map stays as-is */ });
    }

    function switchToOnline() {
      if (!offlineRef.current) return;
      offlineRef.current = false;
      fetch(ONLINE_STYLE)
        .then((r) => r.json())
        .then((style) => { map.setStyle(style); })
        .catch(() => { /* stay offline */ offlineRef.current = true; });
    }

    window.addEventListener("offline", switchToOffline);
    window.addEventListener("online", switchToOnline);

    // Also detect tile load failures as a signal to go offline
    let tileErrors = 0;
    map.on("error", (e) => {
      if (e.error?.message?.includes("fetch") || e.error?.message?.includes("NetworkError")) {
        tileErrors++;
        if (tileErrors >= 3 && !offlineRef.current) switchToOffline();
      }
    });

    // Check initial state
    if (!navigator.onLine) switchToOffline();

    mapRef.current = map;

    return () => {
      readyRef.current = false;
      window.removeEventListener("offline", switchToOffline);
      window.removeEventListener("online", switchToOnline);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Update data sources when props change ────────────────────────────────

  const updateSource = useCallback(
    (sourceId: string, data: GeoJSON.FeatureCollection) => {
      const map = mapRef.current;
      if (!map || !readyRef.current) return;
      const src = map.getSource(sourceId) as GeoJSONSource | undefined;
      src?.setData(data);
    },
    [],
  );

  useEffect(() => updateSource("incidents", toIncidentsGeoJSON(incidents)), [incidents, updateSource]);
  useEffect(() => updateSource("helpRequests", toHelpRequestsGeoJSON(helpRequests)), [helpRequests, updateSource]);
  useEffect(() => updateSource("shelters", toSheltersGeoJSON(shelters)), [shelters, updateSource]);
  useEffect(() => updateSource("riverLevels", toRiverLevelsGeoJSON(riverLevels)), [riverLevels, updateSource]);

  // ── Toggle layer visibility ──────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    const layerGroups: Record<string, string[]> = {
      incidents: ["incidents-clusters", "incidents-cluster-count", "incidents-unclustered"],
      helpRequests: ["help-clusters", "help-cluster-count", "help-unclustered"],
      shelters: ["shelters"],
      riverLevels: ["rivers"],
    };

    for (const [key, layerIds] of Object.entries(layerGroups)) {
      const vis = layers[key] ? "visible" : "none";
      for (const id of layerIds) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", vis);
        }
      }
    }
  }, [layers]);

  return <div ref={containerRef} className="map-container" />;
});
