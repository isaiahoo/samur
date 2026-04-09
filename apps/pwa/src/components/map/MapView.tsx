// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState, useCallback, memo } from "react";
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
  AMENITY_LABELS,
} from "@samur/shared";
import { formatRelativeTime } from "@samur/shared";
import { INCIDENT_COLORS, HELP_COLORS, SHELTER_COLORS } from "./MarkerIcons.js";
import {
  toIncidentsGeoJSON,
  toHelpRequestsGeoJSON,
  toSheltersGeoJSON,
  toRiverLevelsGeoJSON,
  toPrecipitationGeoJSON,
  type PrecipitationPoint,
} from "./geoJsonHelpers.js";
import { computeTier, trendArrow, checkUpstreamDanger, type GaugeTier } from "./gaugeUtils.js";
import {
  createMarkerElement,
  updateMarkerElement,
  variantForZoom,
  type GaugeMarkerData,
  type MarkerVariant,
} from "./GaugeMarker.js";

interface Props {
  incidents: Incident[];
  helpRequests: HelpRequest[];
  shelters: Shelter[];
  riverLevels: RiverLevel[];
  precipitation: PrecipitationPoint[];
  layers: Record<string, boolean>;
  crisisMode?: boolean;
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

// trendArrow is now imported from gaugeUtils

// staleWarning + riverPopupHTML removed — gauge stations now use HTML markers + bottom sheet detail panel

/** Set z-index on the MapLibre marker so danger markers render on top */
function applyMarkerZIndex(marker: maplibregl.Marker, tier: GaugeTier) {
  // maplibregl.Marker.getElement() returns the root container div
  const el = marker.getElement();
  if (el) el.style.zIndex = String(tier.hasData ? tier.tier : 0);
}

// ── Component ──────────────────────────────────────────────────────────────

export const MapView = memo(function MapView({
  incidents,
  helpRequests,
  shelters,
  riverLevels,
  precipitation,
  layers,
  crisisMode,
  onMarkerClick,
  onMapMove,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [mapReady, setMapReady] = useState(false);
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

      // River flood risk heatmap source (uses same data as HTML markers)
      map.addSource("riverHeatmap", { type: "geojson", data: EMPTY_FC });

      // Precipitation forecast heatmap source
      map.addSource("precipHeatmap", { type: "geojson", data: EMPTY_FC });

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

      // ── River flood risk heatmap (warm: amber -> red) ───────────────────

      map.addLayer({
        id: "river-heatmap",
        type: "heatmap",
        source: "riverHeatmap",
        paint: {
          // Weight each point by heatWeight property (0-1)
          "heatmap-weight": ["get", "heatWeight"],
          // Intensity ramps up with zoom
          "heatmap-intensity": [
            "interpolate", ["linear"], ["zoom"],
            6, 0.8,
            10, 1.5,
            14, 2.0,
          ],
          // Radius grows with zoom for coverage
          "heatmap-radius": [
            "interpolate", ["linear"], ["zoom"],
            6, 30,
            9, 60,
            12, 80,
          ],
          // Warm color ramp: transparent -> amber -> red -> dark red
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.15, "rgba(254,243,199,0.4)",  // #FEF3C7 light amber
            0.35, "rgba(245,158,11,0.6)",   // #F59E0B amber
            0.6, "rgba(239,68,68,0.7)",     // #EF4444 red
            1.0, "rgba(153,27,27,0.8)",     // #991B1B dark red
          ],
          // Fade with zoom so markers stay readable
          "heatmap-opacity": [
            "interpolate", ["linear"], ["zoom"],
            7, 0.6,
            11, 0.4,
            14, 0.25,
          ],
        },
      });

      // ── Precipitation forecast heatmap (cool: cyan -> blue) ─────────────

      map.addLayer({
        id: "precip-heatmap",
        type: "heatmap",
        source: "precipHeatmap",
        paint: {
          "heatmap-weight": ["get", "intensity"],
          "heatmap-intensity": [
            "interpolate", ["linear"], ["zoom"],
            6, 0.6,
            10, 1.2,
            14, 1.8,
          ],
          "heatmap-radius": [
            "interpolate", ["linear"], ["zoom"],
            6, 25,
            9, 50,
            12, 70,
          ],
          // Cool color ramp: transparent -> cyan -> blue
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.15, "rgba(207,250,254,0.3)",  // #CFFAFE light cyan
            0.35, "rgba(6,182,212,0.4)",    // #06B6D4 cyan
            0.6, "rgba(30,64,175,0.5)",     // #1E40AF blue
            1.0, "rgba(30,64,175,0.6)",     // #1E40AF deep blue
          ],
          "heatmap-opacity": [
            "interpolate", ["linear"], ["zoom"],
            7, 0.4,
            11, 0.35,
            14, 0.2,
          ],
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
    [mapReady],
  );

  useEffect(() => updateSource("incidents", toIncidentsGeoJSON(incidents)), [incidents, updateSource]);
  useEffect(() => updateSource("helpRequests", toHelpRequestsGeoJSON(helpRequests)), [helpRequests, updateSource]);
  useEffect(() => updateSource("shelters", toSheltersGeoJSON(shelters)), [shelters, updateSource]);
  useEffect(() => updateSource("riverHeatmap", toRiverLevelsGeoJSON(riverLevels)), [riverLevels, updateSource]);
  useEffect(() => updateSource("precipHeatmap", toPrecipitationGeoJSON(precipitation)), [precipitation, updateSource]);

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
    const variant = variantForZoom(currentZoomRef.current);

    for (const r of riverLevels) {
      const key = `${r.riverName}::${r.stationName}`;
      activeKeys.add(key);

      const tier = computeTier(r);
      const arrow = trendArrow(r.trend);
      const upstream = checkUpstreamDanger(r.riverName, r.stationName, tier, riverLevels);
      const markerData: GaugeMarkerData = {
        riverName: r.riverName,
        stationName: r.stationName,
        arrow,
        tier,
        upstream,
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
  }, [riverLevels, mapReady]);

  // Zoom change: swap marker variants (dot/pill/card)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const onZoom = () => {
      const zoom = map.getZoom();
      const newVariant = variantForZoom(zoom);
      const oldVariant = variantForZoom(currentZoomRef.current);
      currentZoomRef.current = zoom;

      if (newVariant === oldVariant) return;

      // Rebuild all markers with new variant
      const existing = gaugeMarkersRef.current;
      for (const [key, entry] of existing) {
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

  // ── Toggle layer visibility ──────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const layerGroups: Record<string, string[]> = {
      incidents: ["incidents-clusters", "incidents-cluster-count", "incidents-unclustered"],
      helpRequests: ["help-clusters", "help-cluster-count", "help-unclustered"],
      shelters: ["shelters"],
      floodHeatmap: ["river-heatmap"],
      precipitation: ["precip-heatmap"],
    };

    for (const [key, layerIds] of Object.entries(layerGroups)) {
      const vis = layers[key] ? "visible" : "none";
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
});
