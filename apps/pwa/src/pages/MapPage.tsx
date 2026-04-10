// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { Incident, HelpRequest, Shelter, RiverLevel, EarthquakeEvent } from "@samur/shared";
import { MapView, type MapViewHandle, type MarkerType } from "../components/map/MapView.js";
import { LayerToggle } from "../components/map/LayerToggle.js";
import { TimelineSlider } from "../components/map/TimelineSlider.js";
import { ReportForm } from "../components/map/ReportForm.js";
import { DetailPanel } from "../components/map/DetailPanel.js";
import { MapLegends } from "../components/map/MapLegends.js";
import { EventPanel } from "../components/map/EventPanel.js";
import { computeTier } from "../components/map/gaugeUtils.js";
import { getIncidents, getHelpRequests, getShelters, getRiverLevels, getRiverLevelForecast, getPrecipitation, getSoilMoisture, getSnowData, getRunoffData, getEarthquakes } from "../services/api.js";
import type { PrecipitationPoint, SoilMoisturePoint, SnowPoint, RunoffPoint } from "../components/map/geoJsonHelpers.js";
import { cacheItems, getCachedItems } from "../services/db.js";
import { useSocketEvent, useSocketSubscription } from "../hooks/useSocket.js";
import { useGeolocation } from "../hooks/useGeolocation.js";
import { useUIStore } from "../store/ui.js";

type MapBounds = { north: number; south: number; east: number; west: number };

export function MapPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [helpRequests, setHelpRequests] = useState<HelpRequest[]>([]);
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [riverLevels, setRiverLevels] = useState<RiverLevel[]>([]);
  const [precipitation, setPrecipitation] = useState<PrecipitationPoint[]>([]);
  const [soilMoisture, setSoilMoisture] = useState<SoilMoisturePoint[]>([]);
  const [snowData, setSnowData] = useState<SnowPoint[]>([]);
  const [runoffData, setRunoffData] = useState<RunoffPoint[]>([]);
  const [earthquakes, setEarthquakes] = useState<EarthquakeEvent[]>([]);
  const [showReport, setShowReport] = useState(false);
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);

  // Timeline scrubber state
  type ForecastReading = {
    riverName: string; stationName: string; lat: number; lng: number;
    levelCm: number | null; dangerLevelCm: number | null;
    dischargeCubicM: number | null; dischargeMean: number | null; dischargeMax: number | null;
    dataSource: string | null; isForecast: boolean; trend: string; measuredAt: string;
  };
  const [forecastData, setForecastData] = useState<ForecastReading[]>([]);
  const [timelineIndex, setTimelineIndex] = useState(0);

  const [layers, setLayers] = useState(() => ({
    incidents: true,
    helpRequests: true,
    shelters: true,
    riverLevels: true,
    floodHeatmap: true,
    precipitation: false,
    soilMoisture: false,
    snow: false,
    runoff: false,
    earthquakes: false,
  }));

  const boundsRef = useRef<MapBounds | null>(null);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const effectiveRiverLevelsRef = useRef<RiverLevel[]>([]);
  const soilMoistureRef = useRef<SoilMoisturePoint[]>([]);
  const mapViewRef = useRef<MapViewHandle>(null);
  const [eventPanelOpen, setEventPanelOpen] = useState(true);
  const { position, requestPosition } = useGeolocation();
  const openSheet = useUIStore((s) => s.openSheet);
  const closeSheet = useUIStore((s) => s.closeSheet);
  const setCrisis = useUIStore((s) => s.setCrisis);
  const crisisMode = useUIStore((s) => s.crisisMode);

  useSocketSubscription(position?.lat ?? null, position?.lng ?? null, 50000);

  // River levels are a small fixed dataset — fetch once, update via WebSocket
  const fetchRiverLevels = useCallback(async () => {
    try {
      const rlRes = await getRiverLevels({ latest: true });
      if (rlRes?.data) setRiverLevels(rlRes.data as RiverLevel[]);
    } catch { /* ignore — will retry on next hourly scrape via socket */ }
  }, []);

  // Precipitation grid — fetch once on mount (cached on backend for 6h)
  const fetchPrecipData = useCallback(async () => {
    try {
      const res = await getPrecipitation();
      if (res?.data) setPrecipitation(res.data);
    } catch { /* ignore — optional overlay */ }
  }, []);

  // Soil moisture grid — fetch once on mount (cached on backend for 6h)
  const fetchSoilMoistureData = useCallback(async () => {
    try {
      const res = await getSoilMoisture();
      if (res?.data) setSoilMoisture(res.data);
    } catch { /* ignore — optional overlay */ }
  }, []);

  // Snow/snowmelt grid — fetch once on mount (cached on backend for 6h)
  const fetchSnowData = useCallback(async () => {
    try {
      const res = await getSnowData();
      if (res?.data) setSnowData(res.data);
    } catch { /* ignore — optional overlay */ }
  }, []);

  // Surface runoff risk — fetch once on mount (derived from precip + soil moisture)
  const fetchRunoffData = useCallback(async () => {
    try {
      const res = await getRunoffData();
      if (res?.data) setRunoffData(res.data);
    } catch { /* ignore — optional overlay */ }
  }, []);

  // Earthquake data — fetch on mount, auto-refresh every 5 minutes
  const fetchEarthquakeData = useCallback(async () => {
    try {
      const res = await getEarthquakes();
      if (res?.data) setEarthquakes(res.data);
    } catch { /* ignore — optional overlay */ }
  }, []);

  // Bulk forecast data for timeline scrubber
  const fetchForecastData = useCallback(async () => {
    try {
      const res = await getRiverLevelForecast();
      if (res?.data) {
        setForecastData(res.data);
        // Set initial timeline index to today
        const todayStr = new Date().toISOString().slice(0, 10);
        const allDates = [...new Set(res.data.map((r) => r.measuredAt.slice(0, 10)))].sort();
        const todayIdx = allDates.indexOf(todayStr);
        setTimelineIndex(todayIdx >= 0 ? todayIdx : 0);
      }
    } catch { /* ignore — timeline is enhancement, not critical */ }
  }, []);

  // Bounds-dependent data — refetch on map move
  const fetchData = useCallback(async () => {
    try {
      const bounds = boundsRef.current;
      const params: Record<string, string | number> = { limit: 100 };
      if (bounds) {
        params.north = bounds.north;
        params.south = bounds.south;
        params.east = bounds.east;
        params.west = bounds.west;
      }

      const [incRes, hrRes, shRes] = await Promise.all([
        getIncidents({ ...params, status: "unverified" }).catch(() => null),
        getHelpRequests({ ...params, status: "open" }).catch(() => null),
        getShelters({ limit: 100 }).catch(() => null),
      ]);

      const incData = (incRes?.data ?? []) as Incident[];
      const hrData = (hrRes?.data ?? []) as HelpRequest[];
      const shData = (shRes?.data ?? []) as Shelter[];

      setIncidents(incData);
      setHelpRequests(hrData);
      setShelters(shData);

      // Cache for offline
      await Promise.all([
        cacheItems("incidents", incData as unknown as Record<string, unknown>[]),
        cacheItems("help_requests", hrData as unknown as Record<string, unknown>[]),
        cacheItems("shelters", shData as unknown as Record<string, unknown>[]),
      ]);
    } catch {
      // Fallback to cached data
      const [cachedInc, cachedHr, cachedSh] = await Promise.all([
        getCachedItems("incidents"),
        getCachedItems("help_requests"),
        getCachedItems("shelters"),
      ]);
      setIncidents(cachedInc as unknown as Incident[]);
      setHelpRequests(cachedHr as unknown as HelpRequest[]);
      setShelters(cachedSh as unknown as Shelter[]);
    }
  }, []);

  // Initial data fetch — river levels + precipitation + soil moisture + snow + forecast loaded once, rest refetched on map move
  useEffect(() => {
    fetchData();
    fetchRiverLevels();
    fetchPrecipData();
    fetchSoilMoistureData();
    fetchSnowData();
    fetchRunoffData();
    fetchEarthquakeData();
    fetchForecastData();
    // Refresh earthquake data every 5 minutes
    const eqInterval = setInterval(fetchEarthquakeData, 5 * 60 * 1000);
    return () => {
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
      clearInterval(eqInterval);
    };
  }, [fetchData, fetchRiverLevels, fetchPrecipData, fetchSoilMoistureData, fetchSnowData, fetchRunoffData, fetchEarthquakeData, fetchForecastData]);

  useEffect(() => {
    requestPosition();
  }, [requestPosition]);

  useSocketEvent("incident:created", (inc) => {
    setIncidents((prev) => [inc, ...prev]);
  });
  useSocketEvent("incident:updated", (inc) => {
    setIncidents((prev) => prev.map((i) => (i.id === inc.id ? inc : i)));
  });
  useSocketEvent("help_request:created", (hr) => {
    setHelpRequests((prev) => [hr, ...prev]);
  });
  useSocketEvent("help_request:updated", (hr) => {
    setHelpRequests((prev) => prev.map((h) => (h.id === hr.id ? hr : h)));
  });
  useSocketEvent("help_request:claimed", (hr) => {
    setHelpRequests((prev) => prev.map((h) => (h.id === hr.id ? hr : h)));
  });
  useSocketEvent("shelter:updated", (s) => {
    setShelters((prev) => prev.map((sh) => (sh.id === s.id ? s : sh)));
  });
  useSocketEvent("earthquake:new", (eq) => {
    setEarthquakes((prev) => {
      const exists = prev.some((e) => e.usgsId === eq.usgsId);
      return exists ? prev : [eq, ...prev];
    });
  });
  useSocketEvent("river_level:updated", (rl) => {
    setRiverLevels((prev) => {
      const idx = prev.findIndex(
        (r) => r.riverName === rl.riverName && r.stationName === rl.stationName,
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = rl;
        return next;
      }
      return [...prev, rl];
    });
  });

  // ── Timeline: group forecast data by date, derive effective river levels ──

  const { timelineDates, effectiveRiverLevels } = useMemo(() => {
    if (forecastData.length === 0) {
      return { timelineDates: [] as string[], effectiveRiverLevels: riverLevels };
    }

    // Extract unique dates sorted
    const dateSet = new Set(forecastData.map((r) => r.measuredAt.slice(0, 10)));
    const allDates = [...dateSet].sort();

    const todayStr = new Date().toISOString().slice(0, 10);
    const todayIdx = allDates.indexOf(todayStr);
    const selectedDate = allDates[timelineIndex] ?? todayStr;

    // If viewing today (or no forecast loaded), use live data
    if (selectedDate === todayStr || timelineIndex === todayIdx) {
      return { timelineDates: allDates, effectiveRiverLevels: riverLevels };
    }

    // For other dates, pick the latest reading per station for that date
    const dateReadings = forecastData.filter(
      (r) => r.measuredAt.slice(0, 10) === selectedDate,
    );

    // Group by station, take latest per station
    const stationMap = new Map<string, ForecastReading>();
    for (const r of dateReadings) {
      const key = `${r.riverName}::${r.stationName}`;
      const existing = stationMap.get(key);
      if (!existing || r.measuredAt > existing.measuredAt) {
        stationMap.set(key, r);
      }
    }

    // Convert to RiverLevel-compatible objects
    const derived = [...stationMap.values()].map((r) => ({
      ...r,
      id: `forecast-${r.riverName}-${r.stationName}-${selectedDate}`,
      createdAt: r.measuredAt,
    })) as unknown as RiverLevel[];

    return { timelineDates: allDates, effectiveRiverLevels: derived };
  }, [forecastData, riverLevels, timelineIndex]);

  // ── Crisis detection: activate when any station reaches Tier 4 ──
  useEffect(() => {
    const rivers: string[] = [];
    for (const r of effectiveRiverLevels) {
      const t = computeTier(r);
      if (t.tier === 4 && t.hasData && !rivers.includes(r.riverName)) {
        rivers.push(r.riverName);
      }
    }
    setCrisis(rivers.length > 0, rivers);
  }, [effectiveRiverLevels, setCrisis]);

  const handleTimelineChange = useCallback((index: number) => {
    setTimelineIndex(index);
  }, []);

  // Keep refs in sync for stable callback
  effectiveRiverLevelsRef.current = effectiveRiverLevels;
  soilMoistureRef.current = soilMoisture;

  const handleMarkerClick = useCallback(
    (type: string, item: Incident | HelpRequest | Shelter | RiverLevel | EarthquakeEvent | Record<string, unknown>) => {
      openSheet(<DetailPanel type={type} data={item} allRiverLevels={effectiveRiverLevelsRef.current} soilMoisture={soilMoistureRef.current} onClose={closeSheet} />);
    },
    [openSheet, closeSheet],
  );

  const handleEventPanelClick = useCallback(
    (type: MarkerType, item: unknown, key: string) => {
      const loc = item as { lat: number; lng: number };
      mapViewRef.current?.flyTo(loc.lng, loc.lat, 15);
      mapViewRef.current?.highlightMarker(type, key);
    },
    [],
  );

  const handleMapMove = useCallback((newBounds: MapBounds, _zoom: number) => {
    boundsRef.current = newBounds;
    // Debounce: refetch data 800ms after the user stops moving the map
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(() => { fetchData(); }, 800);
  }, [fetchData]);

  const toggleLayer = useCallback((key: string) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key as keyof typeof prev] }));
  }, []);

  const layerConfigs = [
    { key: "incidents", label: "Инциденты", active: layers.incidents },
    { key: "helpRequests", label: "Запросы помощи", active: layers.helpRequests },
    { key: "shelters", label: "Убежища", active: layers.shelters },
    { key: "riverLevels", label: "Уровень рек", active: layers.riverLevels },
    { key: "floodHeatmap", label: "Зона затопления", active: layers.floodHeatmap },
    { key: "precipitation", label: "Осадки", active: layers.precipitation },
    { key: "soilMoisture", label: "Влажность почвы", active: layers.soilMoisture },
    { key: "snow", label: "Снег / таяние", active: layers.snow },
    { key: "runoff", label: "Риск затопления", active: layers.runoff },
    { key: "earthquakes", label: "Землетрясения", active: layers.earthquakes },
  ];

  return (
    <div className={`map-page${eventPanelOpen ? " map-page--panel-open" : ""}`}>
      <MapView
        ref={mapViewRef}
        incidents={incidents}
        helpRequests={helpRequests}
        shelters={shelters}
        riverLevels={effectiveRiverLevels}
        precipitation={precipitation}
        soilMoisture={soilMoisture}
        snowData={snowData}
        runoffData={runoffData}
        earthquakes={earthquakes}
        layers={layers}
        crisisMode={crisisMode}
        onMarkerClick={handleMarkerClick}
        onMapMove={handleMapMove}
      />

      <button
        className={`ep-toggle${eventPanelOpen ? " ep-toggle--open" : ""}`}
        onClick={() => setEventPanelOpen(!eventPanelOpen)}
        aria-label={eventPanelOpen ? "Скрыть панель событий" : "Показать панель событий"}
      >
        {eventPanelOpen ? "\u25B6" : "\u25C0"}
      </button>

      {eventPanelOpen && (
        <EventPanel
          incidents={incidents}
          helpRequests={helpRequests}
          shelters={shelters}
          riverLevels={effectiveRiverLevels}
          earthquakes={earthquakes}
          layers={layers}
          onEventClick={handleEventPanelClick}
        />
      )}

      <div className="map-controls">
        <LayerToggle
          layers={layerConfigs}
          onToggle={toggleLayer}
          open={layerMenuOpen}
          onOpenChange={setLayerMenuOpen}
        />
      </div>

      <MapLegends
        layers={layers}
        hasRiverLevels={riverLevels.length > 0}
        hasPrecipitation={precipitation.length > 0}
        hasSoilMoisture={soilMoisture.length > 0}
        hasSnowData={snowData.length > 0}
        hasRunoffData={runoffData.length > 0}
        hasEarthquakes={earthquakes.length > 0}
      />

      {timelineDates.length >= 2 && (
        <TimelineSlider
          dates={timelineDates}
          selectedIndex={timelineIndex}
          onIndexChange={handleTimelineChange}
        />
      )}

      <button
        className="fab"
        onClick={() => setShowReport(true)}
        aria-label="Сообщить"
      >
        <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {showReport && (
        <div className="report-overlay">
          <ReportForm onClose={() => setShowReport(false)} />
        </div>
      )}
    </div>
  );
}

