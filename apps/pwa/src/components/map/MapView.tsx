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
import { loadMarkerSprites } from "./markerSprites.js";
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
  /** Clear the persistent "selected" state on any gauge or earthquake marker. */
  clearMarkerSelection(): void;
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
  aiSeasonalKeys?: Set<string>;
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
  aiSeasonalKeys,
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

  // Persistent marker selection — the user tapped this station/quake, the
  // DetailPanel is open for it. Cleared when the panel closes (from MapPage).
  const selectedGaugeKeyRef = useRef<string | null>(null);
  const selectedEqKeyRef = useRef<string | null>(null);

  const applyGaugeSelection = (key: string | null) => {
    const prev = selectedGaugeKeyRef.current;
    if (prev && prev !== key) {
      const old = gaugeMarkersRef.current.get(prev);
      old?.element.classList.remove("gauge-selected");
    }
    selectedGaugeKeyRef.current = key;
    if (key) {
      const cur = gaugeMarkersRef.current.get(key);
      cur?.element.classList.add("gauge-selected");
    }
  };

  const applyEqSelection = (key: string | null) => {
    const prev = selectedEqKeyRef.current;
    if (prev && prev !== key) {
      const old = eqMarkersRef.current.get(prev);
      old?.element.classList.remove("eq-marker--selected");
    }
    selectedEqKeyRef.current = key;
    if (key) {
      const cur = eqMarkersRef.current.get(key);
      cur?.element.classList.add("eq-marker--selected");
    }
  };

  useImperativeHandle(ref, () => ({
    flyTo(lng: number, lat: number, zoom?: number) {
      mapRef.current?.flyTo({ center: [lng, lat], zoom: zoom ?? 15, duration: 1200, essential: true });
    },
    clearMarkerSelection() {
      applyGaugeSelection(null);
      applyEqSelection(null);
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
        // Same accumulator idea as helpRequests — the cluster bubble
        // paints by worst-severity so a cluster with a critical inside
        // reads as red regardless of the surrounding lows.
        map.addSource("incidents", {
          type: "geojson",
          data: EMPTY_FC,
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50,
          promoteId: "id",
          clusterProperties: {
            max_severity: [
              "max",
              [
                "case",
                ["==", ["get", "severity"], "critical"], 4,
                ["==", ["get", "severity"], "high"], 3,
                ["==", ["get", "severity"], "medium"], 2,
                1,
              ],
            ],
          },
        });
      }
      if (!map.getSource("helpRequests")) {
        // Cluster accumulators let the cluster layer paint know what's
        // inside each cluster without needing to crack it open:
        //   has_sos       1 if any active (non-cancelled/completed) SOS is in this cluster
        //   max_urgency   highest urgency rank (4=critical, 3=urgent, 1=normal)
        // These are read by the cluster paint expression to recolor
        // clusters by contents rather than always purple.
        map.addSource("helpRequests", {
          type: "geojson",
          data: EMPTY_FC,
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50,
          promoteId: "id",
          clusterProperties: {
            has_sos: [
              "max",
              [
                "case",
                [
                  "all",
                  ["==", ["get", "isSOS"], true],
                  ["!=", ["get", "status"], "cancelled"],
                  ["!=", ["get", "status"], "completed"],
                ],
                1,
                0,
              ],
            ],
            max_urgency: [
              "max",
              [
                "case",
                ["==", ["get", "urgency"], "critical"], 4,
                ["==", ["get", "urgency"], "urgent"], 3,
                ["==", ["get", "urgency"], "normal"], 1,
                0,
              ],
            ],
          },
        });
      }
      if (!map.getSource("shelters")) map.addSource("shelters", { type: "geojson", data: EMPTY_FC, promoteId: "id" });

      // ── Incident layers ──────────────────────────────────────────────────

      // Cluster — colour tracks the worst severity inside. Stroke white
      // for contrast on every tile colour, size steps with point_count.
      if (!map.getLayer("incidents-clusters")) {
        map.addLayer({
          id: "incidents-clusters",
          type: "circle",
          source: "incidents",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": [
              "case",
              [">=", ["get", "max_severity"], 4], INCIDENT_COLORS.critical,
              [">=", ["get", "max_severity"], 3], INCIDENT_COLORS.high,
              [">=", ["get", "max_severity"], 2], INCIDENT_COLORS.medium,
              INCIDENT_COLORS.low,
            ],
            "circle-radius": ["step", ["get", "point_count"], 18, 10, 24, 50, 32],
            "circle-opacity": 0.9,
            "circle-stroke-width": 3,
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
            "text-size": 14,
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#fff" },
        });
      }

      // Unclustered incidents — same 4D layer stack as help-requests.
      // Base disk colored by severity, ring colored by verification
      // status, incident-type glyph overlaid, cyan highlight on tap.
      const INCIDENT_NOT_CLUSTERED: maplibregl.FilterSpecification =
        ["!", ["has", "point_count"]] as unknown as maplibregl.FilterSpecification;

      const INCIDENT_FILL: maplibregl.ExpressionSpecification = [
        "case",
        ["==", ["get", "status"], "resolved"], "#6B7280",
        ["==", ["get", "status"], "false_report"], "#A1A1AA",
        ["==", ["get", "severity"], "critical"], INCIDENT_COLORS.critical,
        ["==", ["get", "severity"], "high"], INCIDENT_COLORS.high,
        ["==", ["get", "severity"], "medium"], INCIDENT_COLORS.medium,
        INCIDENT_COLORS.low,
      ] as unknown as maplibregl.ExpressionSpecification;

      // Status ring — "unverified" wears a dashed feel via a thinner
      // white ring; "verified" gets a prominent solid blue ring that
      // tells volunteers "this has been vouched for"; "resolved" and
      // "false_report" fade into gray/neutral so they're clearly
      // historical rather than actionable.
      const INCIDENT_RING: maplibregl.ExpressionSpecification = [
        "case",
        ["==", ["get", "status"], "verified"], "#3B82F6",
        ["==", ["get", "status"], "resolved"], "#16A34A",
        ["==", ["get", "status"], "false_report"], "#52525B",
        "#FFFFFF",
      ] as unknown as maplibregl.ExpressionSpecification;

      // Radius — critical incidents get the same visual weight as
      // critical help requests so the eye ranks them together.
      const INCIDENT_RADIUS: maplibregl.ExpressionSpecification = [
        "case",
        ["==", ["get", "severity"], "critical"], 14,
        ["==", ["get", "severity"], "high"], 12,
        10,
      ] as unknown as maplibregl.ExpressionSpecification;

      if (!map.getLayer("incidents-base")) {
        map.addLayer({
          id: "incidents-base",
          type: "circle",
          source: "incidents",
          filter: INCIDENT_NOT_CLUSTERED,
          paint: {
            "circle-color": INCIDENT_FILL,
            "circle-radius": INCIDENT_RADIUS,
            "circle-opacity": [
              "case",
              ["==", ["get", "status"], "resolved"], 0.55,
              ["==", ["get", "status"], "false_report"], 0.35,
              1,
            ],
            "circle-stroke-width": 0,
          },
        });
      }

      if (!map.getLayer("incidents-status-ring")) {
        map.addLayer({
          id: "incidents-status-ring",
          type: "circle",
          source: "incidents",
          filter: INCIDENT_NOT_CLUSTERED,
          paint: {
            "circle-color": "rgba(0,0,0,0)",
            "circle-radius": INCIDENT_RADIUS,
            "circle-stroke-color": INCIDENT_RING,
            "circle-stroke-width": [
              "case",
              ["any",
                ["==", ["get", "status"], "verified"],
                ["==", ["get", "status"], "resolved"],
                ["==", ["get", "status"], "false_report"],
              ], 3,
              2.5,
            ],
            "circle-stroke-opacity": [
              "case",
              ["==", ["get", "status"], "false_report"], 0.5,
              1,
            ],
          },
        });
      }

      if (!map.getLayer("incidents-icons")) {
        map.addLayer({
          id: "incidents-icons",
          type: "symbol",
          source: "incidents",
          filter: INCIDENT_NOT_CLUSTERED,
          layout: {
            "icon-image": [
              "case",
              ["==", ["get", "type"], "flood"], "kunak-icon-incident_flood",
              ["==", ["get", "type"], "mudslide"], "kunak-icon-incident_mudslide",
              ["==", ["get", "type"], "landslide"], "kunak-icon-incident_landslide",
              ["==", ["get", "type"], "road_blocked"], "kunak-icon-incident_road_blocked",
              ["==", ["get", "type"], "building_damaged"], "kunak-icon-incident_building_damaged",
              ["==", ["get", "type"], "power_out"], "kunak-icon-incident_power_out",
              ["==", ["get", "type"], "water_contaminated"], "kunak-icon-incident_water_contaminated",
              "kunak-icon-other",
            ],
            "icon-size": [
              "case",
              ["==", ["get", "severity"], "critical"], 0.46,
              ["==", ["get", "severity"], "high"], 0.4,
              0.35,
            ],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: {
            "icon-color": "#FFFFFF",
            "icon-opacity": [
              "case",
              ["==", ["get", "status"], "false_report"], 0.5,
              1,
            ],
          },
        });
      }

      if (!map.getLayer("incidents-highlight")) {
        map.addLayer({
          id: "incidents-highlight",
          type: "circle",
          source: "incidents",
          filter: INCIDENT_NOT_CLUSTERED,
          paint: {
            "circle-color": "rgba(0,0,0,0)",
            "circle-radius": [
              "case",
              ["boolean", ["feature-state", "highlighted"], false],
              ["case",
                ["==", ["get", "severity"], "critical"], 18,
                ["==", ["get", "severity"], "high"], 16,
                14,
              ],
              0,
            ],
            "circle-stroke-color": "#06B6D4",
            "circle-stroke-width": [
              "case",
              ["boolean", ["feature-state", "highlighted"], false], 4, 0,
            ],
          },
        });
      }

      // ── Help request layers ──────────────────────────────────────────────

      // ── Clusters ──────────────────────────────────────────────────────
      // Colour follows the worst thing inside: red+pulse-ready if any
      // active SOS, orange if critical/urgent, else neutral purple.
      if (!map.getLayer("help-clusters")) {
        map.addLayer({
          id: "help-clusters",
          type: "circle",
          source: "helpRequests",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": [
              "case",
              ["==", ["get", "has_sos"], 1], "#DC2626",
              [">=", ["get", "max_urgency"], 3], "#F97316",
              "#8B5CF6",
            ],
            "circle-radius": ["step", ["get", "point_count"], 18, 10, 24, 50, 32],
            "circle-opacity": 0.9,
            "circle-stroke-width": 3,
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
            "text-size": 14,
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#fff" },
        });
      }

      // ── Unclustered help-request markers ──────────────────────────────
      // Layer stack, bottom-to-top:
      //   1. help-sos-pulse   expanding halo on active SOSes (rAF-driven)
      //   2. help-base        colored disk (urgency/type)
      //   3. help-status-ring status-aware ring overlay
      //   4. help-icons       SDF category glyph (white, tinted none)
      //   5. help-highlight   cyan ring on the currently-tapped marker
      //
      // All filter on ["!", ["has", "point_count"]] so the point_count
      // lookup never fires on cluster features.
      const NOT_CLUSTERED: maplibregl.FilterSpecification = ["!", ["has", "point_count"]] as unknown as maplibregl.FilterSpecification;
      const ACTIVE_SOS: maplibregl.FilterSpecification = [
        "all",
        ["!", ["has", "point_count"]],
        ["==", ["get", "isSOS"], true],
        ["!=", ["get", "status"], "cancelled"],
        ["!=", ["get", "status"], "completed"],
      ] as unknown as maplibregl.FilterSpecification;

      // Color fill — urgency-driven for needs, green for offers.
      // Cancelled/completed dim to gray.
      const FILL_COLOR: maplibregl.ExpressionSpecification = [
        "case",
        ["==", ["get", "status"], "cancelled"], "#A1A1AA",
        ["==", ["get", "status"], "completed"], "#6B7280",
        ["==", ["get", "type"], "offer"], "#22C55E",
        ["==", ["get", "isSOS"], true], "#DC2626",
        ["==", ["get", "urgency"], "critical"], "#EF4444",
        ["==", ["get", "urgency"], "urgent"], "#F97316",
        "#FB923C",
      ] as unknown as maplibregl.ExpressionSpecification;

      // Status ring — open=white, claimed=amber, in_progress=blue,
      // completed=green, cancelled=dark gray. Always ≥2px so the
      // marker remains visible against the map tile.
      const RING_COLOR: maplibregl.ExpressionSpecification = [
        "case",
        ["==", ["get", "status"], "claimed"], "#F59E0B",
        ["==", ["get", "status"], "in_progress"], "#3B82F6",
        ["==", ["get", "status"], "completed"], "#16A34A",
        ["==", ["get", "status"], "cancelled"], "#52525B",
        "#FFFFFF",
      ] as unknown as maplibregl.ExpressionSpecification;

      // SOS pulsing halo — the circle-radius + circle-opacity are
      // overwritten by an rAF loop (see pulseHelpSosRef). The paint
      // values here are the steady-state starting point; the loop
      // drives the animation.
      if (!map.getLayer("help-sos-pulse")) {
        map.addLayer({
          id: "help-sos-pulse",
          type: "circle",
          source: "helpRequests",
          filter: ACTIVE_SOS,
          paint: {
            "circle-color": "#DC2626",
            "circle-radius": 18,
            "circle-opacity": 0.5,
            "circle-stroke-width": 0,
          },
        });
      }

      // Marker radius drives both the base fill and the outer status
      // ring. Tuned for thumb-reachable tap-targets on mobile and for
      // the category glyph inside to read at a glance:
      //   SOS        18 px  (36 px disk — reads across a room)
      //   Critical   14 px  (28 px disk)
      //   Normal     12 px  (24 px disk)
      const RADIUS: maplibregl.ExpressionSpecification = [
        "case",
        ["==", ["get", "isSOS"], true], 18,
        ["==", ["get", "urgency"], "critical"], 14,
        12,
      ] as unknown as maplibregl.ExpressionSpecification;

      if (!map.getLayer("help-base")) {
        map.addLayer({
          id: "help-base",
          type: "circle",
          source: "helpRequests",
          filter: NOT_CLUSTERED,
          paint: {
            "circle-color": FILL_COLOR,
            "circle-radius": RADIUS,
            "circle-opacity": [
              "case",
              ["==", ["get", "status"], "completed"], 0.55,
              ["==", ["get", "status"], "cancelled"], 0.35,
              1,
            ],
            "circle-stroke-width": 0,
          },
        });
      }

      if (!map.getLayer("help-status-ring")) {
        map.addLayer({
          id: "help-status-ring",
          type: "circle",
          source: "helpRequests",
          filter: NOT_CLUSTERED,
          paint: {
            "circle-color": "rgba(0,0,0,0)",
            "circle-radius": RADIUS,
            "circle-stroke-color": RING_COLOR,
            "circle-stroke-width": [
              "case",
              ["any",
                ["==", ["get", "status"], "claimed"],
                ["==", ["get", "status"], "in_progress"],
                ["==", ["get", "status"], "completed"],
              ], 3,
              2.5,
            ],
            "circle-stroke-opacity": [
              "case",
              ["==", ["get", "status"], "cancelled"], 0.5,
              1,
            ],
          },
        });
      }

      // Icon overlay. Picks "sos" glyph for SOS markers, else the
      // matching category; falls back to "other" for any category
      // that ships without a sprite. `icon-color` tints the SDF mask
      // white so it reads against the red/orange/green fill.
      if (!map.getLayer("help-icons")) {
        map.addLayer({
          id: "help-icons",
          type: "symbol",
          source: "helpRequests",
          filter: NOT_CLUSTERED,
          layout: {
            "icon-image": [
              "case",
              ["==", ["get", "isSOS"], true], "kunak-icon-sos",
              ["==", ["get", "category"], "rescue"], "kunak-icon-rescue",
              ["==", ["get", "category"], "shelter"], "kunak-icon-shelter",
              ["==", ["get", "category"], "food"], "kunak-icon-food",
              ["==", ["get", "category"], "water"], "kunak-icon-water",
              ["==", ["get", "category"], "medicine"], "kunak-icon-medicine",
              ["==", ["get", "category"], "equipment"], "kunak-icon-equipment",
              ["==", ["get", "category"], "transport"], "kunak-icon-transport",
              ["==", ["get", "category"], "labor"], "kunak-icon-labor",
              ["==", ["get", "category"], "generator"], "kunak-icon-generator",
              ["==", ["get", "category"], "pump"], "kunak-icon-pump",
              "kunak-icon-other",
            ],
            // Icon-size multiplies against the 48 px SDF source. Chosen
            // so the visible glyph (≈70 % of source) roughly matches
            // half the disk diameter — legible without crowding the
            // colored halo that carries urgency info.
            "icon-size": [
              "case",
              ["==", ["get", "isSOS"], true], 0.6,
              ["==", ["get", "urgency"], "critical"], 0.46,
              0.4,
            ],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: {
            "icon-color": "#FFFFFF",
            "icon-opacity": [
              "case",
              ["==", ["get", "status"], "cancelled"], 0.5,
              1,
            ],
          },
        });
      }

      if (!map.getLayer("help-highlight")) {
        map.addLayer({
          id: "help-highlight",
          type: "circle",
          source: "helpRequests",
          filter: NOT_CLUSTERED,
          paint: {
            "circle-color": "rgba(0,0,0,0)",
            "circle-radius": [
              "case",
              ["boolean", ["feature-state", "highlighted"], false],
              ["case", ["==", ["get", "isSOS"], true], 22, 17],
              0,
            ],
            "circle-stroke-color": "#06B6D4",
            "circle-stroke-width": [
              "case",
              ["boolean", ["feature-state", "highlighted"], false], 4, 0,
            ],
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

      // Load category SDF sprites in the background. The icon layer
      // is set up with conditional icon-image expressions that look
      // for "kunak-icon-*" names; until the loader finishes, those
      // images are missing and MapLibre renders no icon — which is
      // acceptable (the fill + status ring still convey enough).
      loadMarkerSprites(map).catch(() => { /* non-critical */ });

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

    showPopup("incidents-base", incidentPopupHTML, "incident");
    showPopup("help-base", helpPopupHTML, "helpRequest");
    showPopup("shelters", shelterPopupHTML, "shelter");
    // rivers popup removed — gauge markers handle clicks directly

    // Pointer cursor on interactive layers
    const interactiveLayers = [
      "incidents-clusters", "incidents-base",
      "help-clusters", "help-base",
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

  // ── SOS pulsing halo animation ──────────────────────────────────────
  // The help-sos-pulse layer is a fat red circle behind the main
  // marker; we breathe circle-radius + circle-opacity once per second
  // so active SOSes visibly grab attention across the map. The loop
  // is a no-op when no active SOSes are visible (MapLibre just
  // doesn't render anything because the layer's filter matches 0
  // features), so the cost is bounded at one setPaintProperty per
  // frame regardless of marker count.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let rafId = 0;
    const start = performance.now();
    const period = 1400;
    // Pulse expands from just-outside the SOS disk (radius 18) out to
    // roughly 2.3× that, then fades as it grows. Anything too tight
    // makes the halo imperceptible; too wide and it swallows
    // neighbouring markers.
    const minR = 20;
    const maxR = 42;

    const animate = (now: number) => {
      const phase = ((now - start) % period) / period;
      const radius = minR + (maxR - minR) * phase;
      const opacity = 0.55 * (1 - phase);
      try {
        if (map.getLayer("help-sos-pulse")) {
          map.setPaintProperty("help-sos-pulse", "circle-radius", radius);
          map.setPaintProperty("help-sos-pulse", "circle-opacity", opacity);
        }
      } catch { /* style may be mid-swap — next frame will recover */ }
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [mapReady, styleVersion]);
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
      const isLiveAi = aiStationKeys?.has(key) ?? false;
      const isSeasonalAi = !isLiveAi && (aiSeasonalKeys?.has(key) ?? false);
      const aiTier = isLiveAi ? "live" : isSeasonalAi ? "seasonal" : undefined;
      const markerData: GaugeMarkerData = {
        riverName: r.riverName,
        stationName: r.stationName,
        trend: r.trend,
        tier,
        upstream,
        aiTier,
        aiSummary: aiTier ? (aiSummaries?.get(key) ?? null) : null,
      };

      const entry = existing.get(key);

      // Click handler that always reads fresh data from ref
      const makeClickHandler = (stationKey: string) => () => {
        applyGaugeSelection(stationKey);
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
          if (selectedGaugeKeyRef.current === key) newEl.classList.add("gauge-selected");
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
        if (selectedGaugeKeyRef.current === key) el.classList.add("gauge-selected");
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
  }, [riverLevels, mapReady, aiStationKeys, aiSeasonalKeys, aiSummaries]);

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
          applyGaugeSelection(key);
          const fresh = riverLevelsRef.current.find(
            (rl) => `${rl.riverName}::${rl.stationName}` === key,
          );
          if (fresh) onMarkerClickRef.current("riverLevel", fresh);
        });
        if (selectedGaugeKeyRef.current === key) newEl.classList.add("gauge-selected");
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

    // Paint stronger events on top of weaker ones — Maplibre appends markers
    // to a single container in insertion order, so adding in ascending
    // magnitude means larger events naturally stack above smaller ones.
    const sorted = [...earthquakes].sort((a, b) => a.magnitude - b.magnitude);

    for (const eq of sorted) {
      activeKeys.add(eq.usgsId);
      if (existing.has(eq.usgsId)) continue;

      const magClass =
        eq.magnitude < 3 ? "tiny" :
        eq.magnitude < 4 ? "small" :
        eq.magnitude < 4.5 ? "moderate" :
        eq.magnitude < 5 ? "strong" :
        eq.magnitude < 6 ? "major" : "great";

      const depthClass =
        eq.depth < 10 ? "shallow" :
        eq.depth <= 50 ? "mid" : "deep";

      const ageH = (Date.now() - new Date(eq.time).getTime()) / 3_600_000;
      const recencyClass =
        ageH < 1 ? "fresh" :
        ageH < 24 ? "recent" :
        ageH < 168 ? "old" : "stale"; // 168h = 7d

      // Pulse only for fresh and non-trivial quakes (< 1h AND M ≥ 4)
      const shouldPulse = recencyClass === "fresh" && eq.magnitude >= 4;

      const el = document.createElement("div");
      el.className = shouldPulse ? "eq-marker eq-marker--pulse" : "eq-marker";
      el.setAttribute("data-mag-class", magClass);
      el.setAttribute("data-depth", depthClass);
      el.setAttribute("data-recency", recencyClass);
      el.innerHTML =
        '<span class="eq-marker-pulse" aria-hidden="true"></span>'
        + '<span class="eq-marker-ring" aria-hidden="true"></span>'
        + '<span class="eq-marker-core">'
        +   `<span class="eq-marker-label">${eq.magnitude.toFixed(1)}</span>`
        + '</span>';

      el.addEventListener("click", () => {
        applyEqSelection(eq.usgsId);
        const fresh = earthquakesRef.current.find((e) => e.usgsId === eq.usgsId);
        if (fresh) onMarkerClickRef.current("earthquake", fresh);
      });

      if (selectedEqKeyRef.current === eq.usgsId) {
        el.classList.add("eq-marker--selected");
      }

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
      incidents: [
        "incidents-clusters", "incidents-cluster-count",
        "incidents-base", "incidents-status-ring",
        "incidents-icons", "incidents-highlight",
      ],
      helpRequests: [
        "help-clusters", "help-cluster-count",
        "help-sos-pulse", "help-base", "help-status-ring",
        "help-icons", "help-highlight",
      ],
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
