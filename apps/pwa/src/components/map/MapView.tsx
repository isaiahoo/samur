// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState, useCallback, memo, forwardRef, useImperativeHandle } from "react";
import maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Incident, HelpRequest, Shelter, RiverLevel, EarthquakeEvent } from "@samur/shared";
import {
  DAGESTAN_CENTER,
  INCIDENT_TYPE_LABELS,
  SEVERITY_LABELS,
  HELP_CATEGORY_LABELS,
  SHELTER_STATUS_LABELS,
  AMENITY_LABELS,
} from "@samur/shared";
import { formatRelativeTime } from "@samur/shared";
import { INCIDENT_COLORS, HELP_COLORS, SHELTER_COLORS } from "./MarkerIcons.js";
import {
  toIncidentsGeoJSON,
  toHelpRequestsGeoJSON,
  toSheltersGeoJSON,
  type PrecipitationPoint,
  type SoilMoisturePoint,
  type SnowPoint,
  type RunoffPoint,
} from "./geoJsonHelpers.js";
import { generateSoilMoistureImage, SOIL_BOUNDS, getSettlementsAtRisk, type SettlementRisk } from "./SoilMoistureOverlay.js";
import { generateSnowOverlayImage, SNOW_BOUNDS, getSettlementsAtMeltRisk } from "./SnowOverlay.js";
import { generateRunoffOverlayImage } from "./RunoffOverlay.js";
import { generatePrecipitationImage } from "./PrecipitationOverlay.js";
import { generateFloodZoneImage } from "./FloodZoneOverlay.js";
import { computeTier, checkUpstreamDanger, type GaugeTier } from "./gaugeUtils.js";
import {
  createMarkerElement,
  updateMarkerElement,
  variantForMarker,
  type GaugeMarkerData,
  type MarkerVariant,
} from "./GaugeMarker.js";

export type MarkerType = "incident" | "helpRequest" | "shelter" | "riverLevel" | "earthquake";

export interface MapViewHandle {
  flyTo(lng: number, lat: number, zoom?: number): void;
  highlightMarker(type: MarkerType, key: string): void;
}
type LayerKey = "incidents" | "helpRequests" | "shelters" | "riverLevels" | "floodHeatmap" | "precipitation" | "soilMoisture" | "snow" | "runoff" | "earthquakes";

interface Props {
  incidents: Incident[];
  helpRequests: HelpRequest[];
  shelters: Shelter[];
  riverLevels: RiverLevel[];
  precipitation: PrecipitationPoint[];
  soilMoisture: SoilMoisturePoint[];
  snowData: SnowPoint[];
  runoffData: RunoffPoint[];
  earthquakes: EarthquakeEvent[];
  layers: Record<LayerKey, boolean>;
  crisisMode?: boolean;
  aiStationKeys?: Set<string>;
  aiSummaries?: Map<string, string>;
  onMarkerClick: (type: MarkerType, item: Incident | HelpRequest | Shelter | RiverLevel | EarthquakeEvent | Record<string, unknown>) => void;
  onMapMove?: (bounds: { north: number; south: number; east: number; west: number }, zoom: number) => void;
}

// ── Empty GeoJSON to use as initial source data ────────────────────────────

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

// ── Popup HTML builders ────────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function photoThumbsHTML(raw: unknown): string {
  try {
    const urls: string[] = JSON.parse((raw as string) || "[]");
    if (urls.length === 0) return "";
    const thumbs = urls.slice(0, 3).map((u) =>
      `<img class="popup-thumb" src="${esc(u)}" alt="" loading="lazy" />`
    ).join("");
    const extra = urls.length > 3 ? `<span class="popup-thumb-more">+${urls.length - 3}</span>` : "";
    return `<div class="popup-thumbs">${thumbs}${extra}</div>`;
  } catch { return ""; }
}

function incidentPopupHTML(p: Record<string, unknown>): string {
  const type = INCIDENT_TYPE_LABELS[p.type as string] ?? p.type;
  const severity = SEVERITY_LABELS[p.severity as string] ?? p.severity;
  const desc = p.description || "Нет описания";
  const time = formatRelativeTime(p.createdAt as string);
  const photos = photoThumbsHTML(p.photoUrls);
  return `<div class="popup-content">${photos}<strong>${esc(type)}</strong><span class="popup-badge severity-${esc(p.severity)}">${esc(severity)}</span><p>${esc(desc)}</p><small>${esc(time)}</small></div>`;
}

function helpPopupHTML(p: Record<string, unknown>): string {
  const cat = HELP_CATEGORY_LABELS[p.category as string] ?? p.category;
  const typeLabel = p.type === "offer" ? "Предлагает помощь" : "Нужна помощь";
  const desc = p.description || "Нет описания";
  const time = formatRelativeTime(p.createdAt as string);
  const photos = photoThumbsHTML(p.photoUrls);
  return `<div class="popup-content">${photos}<strong>${esc(cat)}</strong><p>${esc(typeLabel)}</p><p>${esc(desc)}</p><small>${esc(time)}</small></div>`;
}

function shelterPopupHTML(p: Record<string, unknown>): string {
  const status = SHELTER_STATUS_LABELS[p.status as string] ?? p.status;
  const amenities = (p.amenities as string || "")
    .split(",")
    .filter(Boolean)
    .map((a) => AMENITY_LABELS[a] ?? a)
    .join(", ");
  return `<div class="popup-content"><strong>${esc(p.name)}</strong><span class="popup-status">${esc(status)}</span><p>${esc(p.address)}</p><p>Мест: ${Number(p.currentOccupancy)}/${Number(p.capacity)}</p>${amenities ? `<p>${esc(amenities)}</p>` : ""}</div>`;
}

// trendArrow is now imported from gaugeUtils

// staleWarning + riverPopupHTML removed — gauge stations now use HTML markers + bottom sheet detail panel

/** Set z-index on the MapLibre marker so danger markers render on top */
function applyMarkerZIndex(marker: maplibregl.Marker, tier: GaugeTier) {
  // maplibregl.Marker.getElement() returns the root container div
  const el = marker.getElement();
  if (el) el.style.zIndex = String(tier.hasData ? tier.tier : 0);
}

// ── Component ──────────────────────────────────────────────────────────────

export const MapView = memo(forwardRef<MapViewHandle, Props>(function MapView({
  incidents,
  helpRequests,
  shelters,
  riverLevels,
  precipitation,
  soilMoisture,
  snowData,
  runoffData,
  earthquakes,
  layers,
  crisisMode,
  aiStationKeys,
  aiSummaries,
  onMarkerClick,
  onMapMove,
}: Props, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [styleVersion, setStyleVersion] = useState(0);
  const offlineRef = useRef(false);

  // Store latest callbacks in refs to avoid re-initializing the map
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;
  const onMapMoveRef = useRef(onMapMove);
  onMapMoveRef.current = onMapMove;

  // ── Expose imperative handle for flyTo / highlight ─────────────────────

  const highlightTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useImperativeHandle(ref, () => ({
    flyTo(lng: number, lat: number, zoom?: number) {
      mapRef.current?.flyTo({ center: [lng, lat], zoom: zoom ?? 15, duration: 1200, essential: true });
    },
    highlightMarker(type: MarkerType, key: string) {
      const map = mapRef.current;
      if (!map) return;

      // Clear any previous highlight timers
      for (const t of highlightTimers.current) clearTimeout(t);
      highlightTimers.current = [];

      if (type === "earthquake") {
        const entry = eqMarkersRef.current.get(key);
        if (entry) {
          entry.element.classList.add("marker-highlight");
          highlightTimers.current.push(setTimeout(() => entry.element.classList.remove("marker-highlight"), 3000));
        }
      } else if (type === "riverLevel") {
        const entry = gaugeMarkersRef.current.get(key);
        if (entry) {
          entry.element.classList.add("marker-highlight");
          highlightTimers.current.push(setTimeout(() => entry.element.classList.remove("marker-highlight"), 3000));
        }
      } else {
        // GeoJSON layers: incident, helpRequest, shelter
        const sourceMap: Record<string, string> = { incident: "incidents", helpRequest: "helpRequests", shelter: "shelters" };
        const sourceId = sourceMap[type];
        if (sourceId) {
          map.setFeatureState({ source: sourceId, id: key }, { highlighted: true });
          highlightTimers.current.push(setTimeout(() => {
            map.setFeatureState({ source: sourceId, id: key }, { highlighted: false });
          }, 3000));
        }
      }
    },
  }), [mapReady]);

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
      center: [DAGESTAN_CENTER.lng, DAGESTAN_CENTER.lat],
      zoom: 8,
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

    // ── Reusable layer setup (called on initial load AND after style switches) ──

    function setupSourcesAndLayers() {
      if (!map.getSource("incidents")) {
        map.addSource("incidents", { type: "geojson", data: EMPTY_FC, cluster: true, clusterMaxZoom: 14, clusterRadius: 50, promoteId: "id" });
      }
      if (!map.getSource("helpRequests")) {
        map.addSource("helpRequests", { type: "geojson", data: EMPTY_FC, cluster: true, clusterMaxZoom: 14, clusterRadius: 50, promoteId: "id" });
      }
      if (!map.getSource("shelters")) map.addSource("shelters", { type: "geojson", data: EMPTY_FC, promoteId: "id" });

      // ── Incident layers ──────────────────────────────────────────────────

      if (!map.getLayer("incidents-clusters")) {
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
      }

      if (!map.getLayer("incidents-cluster-count")) {
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
      }

      if (!map.getLayer("incidents-unclustered")) {
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
            "circle-radius": ["case", ["boolean", ["feature-state", "highlighted"], false], 11, 8],
            "circle-stroke-width": ["case", ["boolean", ["feature-state", "highlighted"], false], 4, 2],
            "circle-stroke-color": ["case", ["boolean", ["feature-state", "highlighted"], false], "#06B6D4", "#fff"],
          },
        });
      }

      // ── Help request layers ──────────────────────────────────────────────

      if (!map.getLayer("help-clusters")) {
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
      }

      if (!map.getLayer("help-cluster-count")) {
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
      }

      if (!map.getLayer("help-unclustered")) {
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
            "circle-radius": ["case", ["boolean", ["feature-state", "highlighted"], false], 11, 8],
            "circle-stroke-width": ["case", ["boolean", ["feature-state", "highlighted"], false], 4, 2],
            "circle-stroke-color": ["case", ["boolean", ["feature-state", "highlighted"], false], "#06B6D4", "#fff"],
          },
        });
      }

      // Heatmap overlays (flood zone, precipitation) are added dynamically
      // as canvas-based image sources — see useEffect blocks below.
      // Soil moisture overlay is added dynamically as an image source
      // (IDW-interpolated canvas) — see the soilMoisture useEffect below

      // ── Shelter layer ────────────────────────────────────────────────────

      if (!map.getLayer("shelters")) {
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
            "circle-radius": ["case", ["boolean", ["feature-state", "highlighted"], false], 12, 9],
            "circle-stroke-width": ["case", ["boolean", ["feature-state", "highlighted"], false], 4, 2.5],
            "circle-stroke-color": ["case", ["boolean", ["feature-state", "highlighted"], false], "#06B6D4", "#fff"],
          },
        });
      }
    }

    map.on("load", () => {
      setupSourcesAndLayers();

      // River level layer removed — gauge stations now use HTML markers (see gauge marker effect below)

      setMapReady(true);
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

    function showPopup(layerId: string, builder: (p: Record<string, unknown>) => string, markerType: MarkerType) {
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
    // rivers popup removed — gauge markers handle clicks directly

    // Pointer cursor on interactive layers
    const interactiveLayers = [
      "incidents-clusters", "incidents-unclustered",
      "help-clusters", "help-unclustered",
      "shelters",
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

    // After any style change (offline ↔ online), MapLibre destroys all custom
    // sources/layers. Re-create them and bump styleVersion to trigger data effects.
    let isInitialLoad = true;
    map.on("style.load", () => {
      if (isInitialLoad) { isInitialLoad = false; return; }
      setupSourcesAndLayers();
      setStyleVersion((v) => v + 1);
    });

    function switchToOffline() {
      if (offlineRef.current) return;
      offlineRef.current = true;
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
      setMapReady(false);
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
      if (!map || !mapReady) return;
      const src = map.getSource(sourceId) as GeoJSONSource | undefined;
      src?.setData(data);
    },
    [mapReady, styleVersion],
  );

  useEffect(() => updateSource("incidents", toIncidentsGeoJSON(incidents)), [incidents, updateSource]);
  useEffect(() => updateSource("helpRequests", toHelpRequestsGeoJSON(helpRequests)), [helpRequests, updateSource]);
  useEffect(() => updateSource("shelters", toSheltersGeoJSON(shelters)), [shelters, updateSource]);
  // River heatmap and precipitation are now canvas-based overlays (below)

  // ── Soil moisture: IDW-interpolated canvas overlay ──────────────────────
  // styleVersion dependency ensures re-creation after offline/online style switch
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || soilMoisture.length === 0) return;

    const dataUrl = generateSoilMoistureImage(soilMoisture);
    if (!dataUrl) return;

    const { north, south, east, west } = SOIL_BOUNDS;
    const coords: [[number, number], [number, number], [number, number], [number, number]] = [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ];

    // Always check if source exists — style switches destroy it
    const src = map.getSource("soilMoistureImg") as maplibregl.ImageSource | undefined;
    if (src) {
      src.updateImage({ url: dataUrl, coordinates: coords });
    } else {
      map.addSource("soilMoistureImg", {
        type: "image",
        url: dataUrl,
        coordinates: coords,
      });
      // Find the best insertion point (shelters may not exist after style change)
      const beforeLayer = map.getLayer("shelters") ? "shelters" : undefined;
      map.addLayer(
        {
          id: "soil-moisture-overlay",
          type: "raster",
          source: "soilMoistureImg",
          paint: {
            "raster-opacity": 0.65,
            "raster-fade-duration": 0,
          },
        },
        beforeLayer,
      );
    }
  }, [soilMoisture, mapReady, styleVersion]);

  // ── Precipitation: IDW-interpolated canvas overlay ────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || precipitation.length === 0) return;

    const dataUrl = generatePrecipitationImage(precipitation);
    if (!dataUrl) return;

    const { north, south, east, west } = SOIL_BOUNDS;
    const coords: [[number, number], [number, number], [number, number], [number, number]] = [
      [west, north], [east, north], [east, south], [west, south],
    ];

    const src = map.getSource("precipOverlayImg") as maplibregl.ImageSource | undefined;
    if (src) {
      src.updateImage({ url: dataUrl, coordinates: coords });
    } else {
      map.addSource("precipOverlayImg", {
        type: "image", url: dataUrl, coordinates: coords,
      });
      const beforeLayer = map.getLayer("shelters") ? "shelters" : undefined;
      map.addLayer({
        id: "precip-overlay",
        type: "raster",
        source: "precipOverlayImg",
        paint: { "raster-opacity": 0.9, "raster-fade-duration": 0 },
      }, beforeLayer);
    }
  }, [precipitation, mapReady, styleVersion]);

  // ── Flood zone: circle-based canvas overlay from gauge stations ────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || riverLevels.length === 0) return;

    const dataUrl = generateFloodZoneImage(riverLevels);
    if (!dataUrl) {
      // No stations above threshold — remove overlay if it exists
      if (map.getLayer("flood-zone-overlay")) map.removeLayer("flood-zone-overlay");
      if (map.getSource("floodZoneImg")) map.removeSource("floodZoneImg");
      return;
    }

    const { north, south, east, west } = SOIL_BOUNDS;
    const coords: [[number, number], [number, number], [number, number], [number, number]] = [
      [west, north], [east, north], [east, south], [west, south],
    ];

    const src = map.getSource("floodZoneImg") as maplibregl.ImageSource | undefined;
    if (src) {
      src.updateImage({ url: dataUrl, coordinates: coords });
    } else {
      map.addSource("floodZoneImg", {
        type: "image", url: dataUrl, coordinates: coords,
      });
      const beforeLayer = map.getLayer("shelters") ? "shelters" : undefined;
      map.addLayer({
        id: "flood-zone-overlay",
        type: "raster",
        source: "floodZoneImg",
        paint: { "raster-opacity": 0.6, "raster-fade-duration": 0 },
      }, beforeLayer);
    }
  }, [riverLevels, mapReady, styleVersion]);

  // ── Settlement risk markers (HTML markers for towns in wet zones) ──────

  const settlementMarkersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Remove old markers
    for (const m of settlementMarkersRef.current) m.remove();
    settlementMarkersRef.current = [];

    if (soilMoisture.length === 0 || !layers.soilMoisture) return;

    const atRisk = getSettlementsAtRisk(soilMoisture);
    if (atRisk.length === 0) return;

    for (const s of atRisk) {
      const el = document.createElement("div");
      el.className = `settlement-risk settlement-risk--${s.level}`;
      el.innerHTML = `<span class="settlement-risk-icon">⚠</span><span class="settlement-risk-name">${s.name}</span>`;
      el.title = `${s.name}: влажность почвы ${Math.round(s.moisture * 100)}%`;

      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([s.lng, s.lat])
        .addTo(map);

      settlementMarkersRef.current.push(marker);
    }
  }, [soilMoisture, mapReady, layers.soilMoisture, styleVersion]);

  // ── Snow/snowmelt: IDW-interpolated canvas overlay ────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || snowData.length === 0) return;

    const dataUrl = generateSnowOverlayImage(snowData, "melt");
    if (!dataUrl) return;

    const { north, south, east, west } = SNOW_BOUNDS;
    const coords: [[number, number], [number, number], [number, number], [number, number]] = [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ];

    const src = map.getSource("snowOverlayImg") as maplibregl.ImageSource | undefined;
    if (src) {
      src.updateImage({ url: dataUrl, coordinates: coords });
    } else {
      map.addSource("snowOverlayImg", {
        type: "image",
        url: dataUrl,
        coordinates: coords,
      });
      const beforeLayer = map.getLayer("shelters") ? "shelters" : undefined;
      map.addLayer(
        {
          id: "snow-overlay",
          type: "raster",
          source: "snowOverlayImg",
          paint: {
            "raster-opacity": 0.55,
            "raster-fade-duration": 0,
          },
        },
        beforeLayer,
      );
    }
  }, [snowData, mapReady, styleVersion]);

  // ── Snowmelt settlement risk markers ──────────────────────────────────

  const meltMarkersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Remove old markers
    for (const m of meltMarkersRef.current) m.remove();
    meltMarkersRef.current = [];

    if (snowData.length === 0 || !layers.snow) return;

    const atRisk = getSettlementsAtMeltRisk(snowData);
    if (atRisk.length === 0) return;

    for (const s of atRisk) {
      const el = document.createElement("div");
      el.className = `melt-risk melt-risk--${s.level}`;

      const depthStr = s.maxSnowDepth >= 1
        ? `${s.maxSnowDepth.toFixed(1)} м`
        : `${Math.round(s.maxSnowDepth * 100)} см`;
      // Show melt rate + snow depth, not the city name (gauge markers already show it)
      el.innerHTML = `<span class="melt-risk-icon">🏔</span><span class="melt-risk-label">таяние ${s.meltIndex} мм/сут</span>`;
      el.title = `${s.name}: таяние ${s.meltIndex} мм/сут, снег до ${depthStr}`;

      // Offset slightly above the settlement so it doesn't overlap gauge markers
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -20] })
        .setLngLat([s.lng, s.lat])
        .addTo(map);

      meltMarkersRef.current.push(marker);
    }
  }, [snowData, mapReady, layers.snow, styleVersion]);

  // ── Surface runoff: IDW-interpolated canvas overlay ────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || runoffData.length === 0) return;

    const dataUrl = generateRunoffOverlayImage(runoffData);
    if (!dataUrl) return;

    const { north, south, east, west } = SOIL_BOUNDS;
    const coords: [[number, number], [number, number], [number, number], [number, number]] = [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ];

    const src = map.getSource("runoffOverlayImg") as maplibregl.ImageSource | undefined;
    if (src) {
      src.updateImage({ url: dataUrl, coordinates: coords });
    } else {
      map.addSource("runoffOverlayImg", {
        type: "image",
        url: dataUrl,
        coordinates: coords,
      });
      const beforeLayer = map.getLayer("shelters") ? "shelters" : undefined;
      map.addLayer(
        {
          id: "runoff-overlay",
          type: "raster",
          source: "runoffOverlayImg",
          paint: {
            "raster-opacity": 0.6,
            "raster-fade-duration": 0,
          },
        },
        beforeLayer,
      );
    }
  }, [runoffData, mapReady, styleVersion]);

  // ── Runoff settlement risk markers ──────────────────────────────────────

  // ── Runoff data-point labels — show evidence at each risky grid point ──

  const runoffMarkersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Remove old markers
    for (const m of runoffMarkersRef.current) m.remove();
    runoffMarkersRef.current = [];

    if (runoffData.length === 0 || !layers.runoff) return;

    // Show a data label at each grid point that has risk
    const riskyPoints = runoffData.filter((p) => p.riskIndex >= 15);

    for (const p of riskyPoints) {
      const el = document.createElement("div");
      const level = p.riskIndex >= 65 ? "extreme" : p.riskIndex >= 35 ? "high" : "moderate";
      el.className = `runoff-data-label runoff-data-label--${level}`;

      // Build evidence lines — show WHY this area is flagged
      const lines: string[] = [];
      if (p.precipitation24h > 0) lines.push(`🌧 ${p.precipitation24h} мм осадков`);
      if (p.soilMoisture > 0.3) lines.push(`💧 почва ${Math.round(p.soilMoisture * 100)}%`);
      lines.push(`⚠️ сток ${p.runoffDepth} мм`);

      el.innerHTML = lines.map((l) => `<div class="runoff-data-line">${l}</div>`).join("");
      el.title = `Риск: ${p.riskIndex}%, сток ${p.runoffDepth} мм`;

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([p.lng, p.lat])
        .addTo(map);

      runoffMarkersRef.current.push(marker);
    }
  }, [runoffData, mapReady, layers.runoff, styleVersion]);

  // ── Gauge station HTML markers ──────────────────────────────────────────

  const gaugeMarkersRef = useRef<Map<string, {
    marker: maplibregl.Marker;
    variant: MarkerVariant;
    data: GaugeMarkerData;
    element: HTMLDivElement;
  }>>(new Map());

  const currentZoomRef = useRef(11);

  // Keep a ref to the latest riverLevels so click handlers aren't stale
  const riverLevelsRef = useRef(riverLevels);
  riverLevelsRef.current = riverLevels;

  // Rebuild all gauge markers when riverLevels data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const existing = gaugeMarkersRef.current;
    const activeKeys = new Set<string>();
    const zoom = currentZoomRef.current;

    for (const r of riverLevels) {
      const key = `${r.riverName}::${r.stationName}`;
      activeKeys.add(key);

      const tier = computeTier(r);
      const variant = variantForMarker(zoom, tier.tier, tier.hasData);
      const upstream = checkUpstreamDanger(r.riverName, r.stationName, tier, riverLevels);
      const hasAi = aiStationKeys?.has(key) ?? false;
      const markerData: GaugeMarkerData = {
        riverName: r.riverName,
        stationName: r.stationName,
        trend: r.trend,
        tier,
        upstream,
        hasAiForecast: hasAi,
        aiSummary: hasAi ? (aiSummaries?.get(key) ?? null) : null,
      };

      const entry = existing.get(key);

      // Click handler that always reads fresh data from ref
      const makeClickHandler = (stationKey: string) => () => {
        const fresh = riverLevelsRef.current.find(
          (rl) => `${rl.riverName}::${rl.stationName}` === stationKey,
        );
        if (fresh) onMarkerClickRef.current("riverLevel", fresh);
      };

      if (entry) {
        // Update existing marker
        const needsRebuild = updateMarkerElement(entry.element, markerData, variant, entry.variant);
        if (needsRebuild) {
          const newEl = createMarkerElement(markerData, variant);
          newEl.addEventListener("click", makeClickHandler(key));
          entry.marker.remove();
          const newMarker = new maplibregl.Marker({ element: newEl, anchor: "center" })
            .setLngLat([r.lng, r.lat])
            .addTo(map);
          applyMarkerZIndex(newMarker, tier);
          existing.set(key, { marker: newMarker, variant, data: markerData, element: newEl });
        } else {
          entry.data = markerData;
          entry.variant = variant;
          entry.marker.setLngLat([r.lng, r.lat]);
          applyMarkerZIndex(entry.marker, tier);
        }
      } else {
        // Create new marker
        const el = createMarkerElement(markerData, variant);
        el.addEventListener("click", makeClickHandler(key));
        const marker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([r.lng, r.lat])
          .addTo(map);
        applyMarkerZIndex(marker, tier);
        existing.set(key, { marker, variant, data: markerData, element: el });
      }
    }

    // Remove markers for stations that are no longer in the data
    for (const [key, entry] of existing) {
      if (!activeKeys.has(key)) {
        entry.marker.remove();
        existing.delete(key);
      }
    }
  }, [riverLevels, mapReady, aiStationKeys, aiSummaries]);

  // Zoom change: swap marker variants (dot/pill/card)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const onZoom = () => {
      const zoom = map.getZoom();
      currentZoomRef.current = zoom;

      // Rebuild only the markers whose variant actually changed — per-marker
      // variants (tier-1 downgraded to dot at mid-zoom) mean we can no longer
      // skip the whole set on a single equality check.
      const existing = gaugeMarkersRef.current;
      for (const [key, entry] of existing) {
        const newVariant = variantForMarker(zoom, entry.data.tier.tier, entry.data.tier.hasData);
        if (newVariant === entry.variant) continue;

        const newEl = createMarkerElement(entry.data, newVariant);
        const lngLat = entry.marker.getLngLat();
        newEl.addEventListener("click", () => {
          const fresh = riverLevelsRef.current.find(
            (rl) => `${rl.riverName}::${rl.stationName}` === key,
          );
          if (fresh) onMarkerClickRef.current("riverLevel", fresh);
        });
        entry.marker.remove();
        const newMarker = new maplibregl.Marker({ element: newEl, anchor: "center" })
          .setLngLat(lngLat)
          .addTo(map);
        applyMarkerZIndex(newMarker, entry.data.tier);
        existing.set(key, { marker: newMarker, variant: newVariant, data: entry.data, element: newEl });
      }
    };

    map.on("zoomend", onZoom);
    return () => { map.off("zoomend", onZoom); };
  }, [mapReady]);

  // Cleanup all gauge markers on unmount
  useEffect(() => {
    return () => {
      for (const entry of gaugeMarkersRef.current.values()) {
        entry.marker.remove();
      }
      gaugeMarkersRef.current.clear();
    };
  }, []);

  // ── Earthquake HTML markers ────────────────────────────────────────────

  const eqMarkersRef = useRef<Map<string, { marker: maplibregl.Marker; element: HTMLDivElement }>>(new Map());
  const earthquakesRef = useRef(earthquakes);
  earthquakesRef.current = earthquakes;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const existing = eqMarkersRef.current;
    const activeKeys = new Set<string>();

    for (const eq of earthquakes) {
      activeKeys.add(eq.usgsId);
      if (existing.has(eq.usgsId)) continue;

      // Marker sizing by magnitude
      const size = eq.magnitude >= 5.5 ? 32 : eq.magnitude >= 4.5 ? 22 : eq.magnitude >= 4.0 ? 14 : 10;

      // Color by recency
      const ageH = (Date.now() - new Date(eq.time).getTime()) / 3_600_000;
      const color = ageH < 1 ? "#ef4444" : ageH < 24 ? "#f97316" : "#eab308";
      const pulse = ageH < 1;

      const el = document.createElement("div");
      el.className = `eq-marker${pulse ? " eq-marker--pulse" : ""}`;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.background = color;
      el.style.borderRadius = "50%";
      el.style.border = "2px solid #fff";
      el.style.cursor = "pointer";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.style.boxShadow = `0 0 6px ${color}80`;

      if (size >= 22) {
        el.style.fontSize = "10px";
        el.style.fontWeight = "700";
        el.style.color = "#fff";
        el.textContent = String(eq.magnitude);
      }

      el.addEventListener("click", () => {
        const fresh = earthquakesRef.current.find((e) => e.usgsId === eq.usgsId);
        if (fresh) onMarkerClickRef.current("earthquake", fresh);
      });

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([eq.lng, eq.lat])
        .addTo(map);
      existing.set(eq.usgsId, { marker, element: el });
    }

    // Remove old markers
    for (const [key, entry] of existing) {
      if (!activeKeys.has(key)) {
        entry.marker.remove();
        existing.delete(key);
      }
    }
  }, [earthquakes, mapReady]);

  // Cleanup earthquake markers on unmount
  useEffect(() => {
    return () => {
      for (const entry of eqMarkersRef.current.values()) {
        entry.marker.remove();
      }
      eqMarkersRef.current.clear();
    };
  }, []);

  // ── Toggle layer visibility ──────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const layerGroups: Record<string, string[]> = {
      incidents: ["incidents-clusters", "incidents-cluster-count", "incidents-unclustered"],
      helpRequests: ["help-clusters", "help-cluster-count", "help-unclustered"],
      shelters: ["shelters"],
      floodHeatmap: ["flood-zone-overlay"],
      precipitation: ["precip-overlay"],
      soilMoisture: ["soil-moisture-overlay"],
      snow: ["snow-overlay"],
      runoff: ["runoff-overlay"],
    };

    for (const [key, layerIds] of Object.entries(layerGroups)) {
      const vis = layers[key as LayerKey] ? "visible" : "none";
      for (const id of layerIds) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", vis);
        }
      }
    }

    // Toggle gauge HTML markers visibility
    const gaugeVis = layers.riverLevels;
    for (const entry of gaugeMarkersRef.current.values()) {
      entry.element.style.display = gaugeVis ? "" : "none";
    }

    // Toggle earthquake HTML markers visibility
    const eqVis = layers.earthquakes;
    for (const entry of eqMarkersRef.current.values()) {
      entry.element.style.display = eqVis ? "" : "none";
    }
  }, [layers, mapReady]);

  // ── Crisis mode: desaturate basemap raster tiles ────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const style = map.getStyle();
    if (!style?.layers) return;
    for (const layer of style.layers) {
      if (layer.type === "raster") {
        map.setPaintProperty(layer.id, "raster-saturation", crisisMode ? -0.5 : 0);
      }
    }
  }, [crisisMode, mapReady]);

  return <div ref={containerRef} className="map-container" />;
}));
