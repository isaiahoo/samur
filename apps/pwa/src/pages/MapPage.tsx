// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import type { Incident, HelpRequest, Shelter, RiverLevel, EarthquakeEvent } from "@samur/shared";
import { MapView, type MapViewHandle, type MarkerType } from "../components/map/MapView.js";
import { LayerToggle } from "../components/map/LayerToggle.js";
import { ForecastPicker } from "../components/map/ForecastPicker.js";
import { ForecastBanner } from "../components/map/ForecastBanner.js";
import { AiAlertBanner } from "../components/map/AiAlertBanner.js";
import { ReportForm } from "../components/map/ReportForm.js";
import { DetailPanel } from "../components/map/DetailPanel.js";
import { MapLegends } from "../components/map/MapLegends.js";
import { EventPanel } from "../components/map/EventPanel.js";
import { computeTier } from "../components/map/gaugeUtils.js";
import { getIncidents, getHelpRequests, getShelters, getRiverLevels, getRiverLevelForecast, getPrecipitation, getSoilMoisture, getSnowData, getRunoffData, getEarthquakes, getAiForecast } from "../services/api.js";
import type { AiForecastPoint } from "../services/api.js";
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
  const [aiStationKeys, setAiStationKeys] = useState<Set<string>>(new Set());
  const [aiSummaries, setAiSummaries] = useState<Map<string, string>>(new Map());

  // Top AI threat — the single most concerning non-seasonal forecast,
  // used to render a map-wide alert banner. null when no station crosses
  // the 75%-of-danger threshold in the next 7 days.
  const [topAiThreat, setTopAiThreat] = useState<{
    riverName: string;
    stationName: string;
    peakCm: number;
    dangerCm: number;
    peakDate: string;
    skill: "high" | "medium";
    above: boolean;
  } | null>(null);
  const [showReport, _setShowReport] = useState(false);
  const setReportFormOpen = useUIStore((s) => s.setReportFormOpen);
  const setShowReport = useCallback((open: boolean) => {
    _setShowReport(open);
    setReportFormOpen(open);
    // Lock body scroll on iOS — CSS alone can't prevent scroll-through
    document.body.style.overflow = open ? "hidden" : "";
    document.documentElement.style.overflow = open ? "hidden" : "";
  }, [setReportFormOpen]);
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
  const { position, status: geoStatus, requestPosition } = useGeolocation();
  const [geoBannerDismissed, setGeoBannerDismissed] = useState(false);
  const openSheet = useUIStore((s) => s.openSheet);
  const closeSheet = useUIStore((s) => s.closeSheet);
  const sheetContent = useUIStore((s) => s.sheetContent);
  const setCrisis = useUIStore((s) => s.setCrisis);
  const crisisMode = useUIStore((s) => s.crisisMode);
  const showToast = useUIStore((s) => s.showToast);

  useSocketSubscription(position?.lat ?? null, position?.lng ?? null, 50000);

  // Mirror crisisMode to :root so purely-CSS gated rules (marker pills,
  // monospace typography) can react without threading a prop into every
  // imperative DOM surface.
  useEffect(() => {
    document.documentElement.classList.toggle("crisis-mode", crisisMode);
    return () => {
      document.documentElement.classList.remove("crisis-mode");
    };
  }, [crisisMode]);

  // When the detail sheet closes, drop the persistent "selected" state on
  // whichever marker was tied to it (gauge station or earthquake).
  useEffect(() => {
    if (!sheetContent) mapViewRef.current?.clearMarkerSelection();
  }, [sheetContent]);

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

  // AI forecast data — determines which stations get the AI ring on the map
  const fetchAiForecast = useCallback(async () => {
    try {
      const res = await getAiForecast();
      if (!res?.data) return;

      // Group by station
      const byStation = new Map<string, AiForecastPoint[]>();
      for (const d of res.data) {
        const key = `${d.riverName}::${d.stationName}`;
        const arr = byStation.get(key) ?? [];
        arr.push(d);
        byStation.set(key, arr);
      }

      const keys = new Set<string>();
      const summaries = new Map<string, string>();
      const skills = res.meta?.skills ?? {};

      // A threat is any forecast point whose upper-bound reaches ≥75% of
      // the station's danger level. Seasonal-source stations get tier=none
      // from the Phase-1 cascade so they're filtered out automatically.
      type Threat = {
        riverName: string; stationName: string;
        peakCm: number; dangerCm: number; peakDate: string;
        skill: "high" | "medium"; above: boolean; pct: number;
      };
      let worst: Threat | null = null;

      for (const [key, points] of byStation) {
        const hasReal = points.some((p) => (p.levelCm ?? 0) > 0);
        if (!hasReal) continue;

        const tier = skills[key]?.tier;
        // Suppress AI ring + threat scan for below-medium skill (NSE < 0.5);
        // server-side gating already drops NSE < 0.3 entirely.
        if (tier === "low" || tier === "none") continue;

        keys.add(key);

        const sorted = [...points].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const firstLevel = first.levelCm ?? 0;
        const lastLevel = last.levelCm ?? 0;
        const days = Math.max(1, Math.round(
          (new Date(last.measuredAt).getTime() - new Date(first.measuredAt).getTime()) / 86400000,
        ));

        if (firstLevel > 0) {
          const pctChange = Math.round(((lastLevel - firstLevel) / firstLevel) * 100);
          const sign = pctChange >= 0 ? "+" : "";
          summaries.set(key, `AI: ${sign}${pctChange}% за ${days} дн.`);
        } else {
          summaries.set(key, `AI: ${Math.round(lastLevel)} см`);
        }

        if (tier !== "high" && tier !== "medium") continue;
        for (const p of points) {
          const danger = p.dangerLevelCm ?? 0;
          if (danger <= 0) continue;
          const upper = p.predictionUpper ?? p.levelCm ?? 0;
          const pct = upper / danger;
          if (pct < 0.75) continue;
          if (!worst || pct > worst.pct) {
            worst = {
              riverName: p.riverName,
              stationName: p.stationName,
              peakCm: p.levelCm ?? upper,
              dangerCm: danger,
              peakDate: p.measuredAt,
              skill: tier,
              above: upper >= danger,
              pct,
            };
          }
        }
      }

      setAiStationKeys(keys);
      setAiSummaries(summaries);
      setTopAiThreat(worst ? {
        riverName: worst.riverName,
        stationName: worst.stationName,
        peakCm: worst.peakCm,
        dangerCm: worst.dangerCm,
        peakDate: worst.peakDate,
        skill: worst.skill,
        above: worst.above,
      } : null);
    } catch { /* ignore — AI overlay is enhancement */ }
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

  // Incidents — bounds-dependent, refetched on map move
  const fetchIncidents = useCallback(async () => {
    try {
      const bounds = boundsRef.current;
      const params: Record<string, string | number> = { limit: 100, status: "unverified" };
      if (bounds) {
        params.north = bounds.north;
        params.south = bounds.south;
        params.east = bounds.east;
        params.west = bounds.west;
      }
      const res = await getIncidents(params).catch(() => null);
      const data = (res?.data ?? []) as Incident[];
      setIncidents(data);
      await cacheItems("incidents", data as unknown as Record<string, unknown>[]);
    } catch {
      const cached = await getCachedItems("incidents");
      setIncidents(cached as unknown as Incident[]);
    }
  }, []);

  // Help requests & shelters — fetched once on mount (low-volume, global data)
  // Updated in real-time via WebSocket, not on map move
  const fetchGlobalData = useCallback(async () => {
    try {
      const [hrRes, shRes] = await Promise.all([
        getHelpRequests({ limit: 100, status: "open" }).catch(() => null),
        getShelters({ limit: 100 }).catch(() => null),
      ]);
      const hrData = (hrRes?.data ?? []) as HelpRequest[];
      const shData = (shRes?.data ?? []) as Shelter[];
      setHelpRequests(hrData);
      setShelters(shData);
      await Promise.all([
        cacheItems("help_requests", hrData as unknown as Record<string, unknown>[]),
        cacheItems("shelters", shData as unknown as Record<string, unknown>[]),
      ]);
    } catch {
      const [cachedHr, cachedSh] = await Promise.all([
        getCachedItems("help_requests"),
        getCachedItems("shelters"),
      ]);
      setHelpRequests(cachedHr as unknown as HelpRequest[]);
      setShelters(cachedSh as unknown as Shelter[]);
    }
  }, []);

  // Initial data fetch — river levels + precipitation + soil moisture + snow + forecast loaded once
  // Help requests & shelters loaded once (updated via WebSocket), incidents refetched on map move
  useEffect(() => {
    fetchIncidents();
    fetchGlobalData();
    fetchRiverLevels();
    fetchPrecipData();
    fetchSoilMoistureData();
    fetchSnowData();
    fetchRunoffData();
    fetchEarthquakeData();
    fetchForecastData();
    fetchAiForecast();
    // Refresh earthquake data every 5 minutes
    const eqInterval = setInterval(fetchEarthquakeData, 5 * 60 * 1000);
    return () => {
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
      clearInterval(eqInterval);
    };
  }, [fetchIncidents, fetchGlobalData, fetchRiverLevels, fetchPrecipData, fetchSoilMoistureData, fetchSnowData, fetchRunoffData, fetchEarthquakeData, fetchForecastData, fetchAiForecast]);

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
  useSocketEvent("sos:created", (hr) => {
    setHelpRequests((prev) => {
      const exists = prev.some((h) => h.id === hr.id);
      return exists ? prev : [hr, ...prev];
    });
    const name = hr.contactName ?? "Неизвестный";
    showToast(`SOS: ${name} просит о помощи`, "error");
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
    // Debounce: refetch incidents (bounds-dependent) 800ms after the user stops moving
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(() => { fetchIncidents(); }, 800);
  }, [fetchIncidents]);

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
    <div className={`map-page${eventPanelOpen ? " map-page--panel-open" : ""}${showReport ? " map-page--report-open" : ""}`}>
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
        aiStationKeys={aiStationKeys}
        aiSummaries={aiSummaries}
        onMarkerClick={handleMarkerClick}
        onMapMove={handleMapMove}
      />

      {(geoStatus === "denied" || (geoStatus === "loading" && !geoBannerDismissed)) && !geoBannerDismissed && (
        <div className="geo-banner">
          {geoStatus === "loading" ? (
            <span className="geo-banner-text">Определяем местоположение…</span>
          ) : !window.isSecureContext ? (
            <>
              <span className="geo-banner-text">
                Геолокация недоступна — сайт открыт по HTTP. Откройте <b>https://mykunak.ru</b> для полного доступа.
              </span>
            </>
          ) : (
            <>
              <span className="geo-banner-text">
                Геолокация отключена. Откройте <b>Настройки &gt; Конфиденциальность &gt; Службы геолокации &gt; Safari</b> и разрешите доступ.
              </span>
              <button className="geo-banner-retry" onClick={requestPosition}>Повторить</button>
            </>
          )}
          <button className="geo-banner-close" onClick={() => setGeoBannerDismissed(true)} aria-label="Закрыть">&times;</button>
        </div>
      )}

      {/* Toggle button — desktop: side tab, mobile: bottom bar */}
      {!eventPanelOpen && (
        <button
          className={`ep-toggle${crisisMode ? " ep-toggle--crisis" : ""}`}
          onClick={() => setEventPanelOpen(true)}
          aria-label="Показать панель событий"
        >
          <svg className="ep-toggle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12h4l3-8 4 16 3-8h4" />
          </svg>
          <span className="ep-toggle-label">{crisisMode ? "МОНИТОРИНГ" : "Мониторинг"}</span>
        </button>
      )}

      {eventPanelOpen && (
        <EventPanel
          incidents={incidents}
          helpRequests={helpRequests}
          shelters={shelters}
          riverLevels={effectiveRiverLevels}
          earthquakes={earthquakes}
          layers={layers}
          userPos={position}
          isLoading={riverLevels.length === 0}
          onEventClick={handleEventPanelClick}
          onClose={() => setEventPanelOpen(false)}
        />
      )}

      <div className="map-controls">
        <LayerToggle
          layers={layerConfigs}
          onToggle={toggleLayer}
          open={layerMenuOpen}
          onOpenChange={setLayerMenuOpen}
        />
        {timelineDates.length >= 2 && (
          <ForecastPicker
            dates={timelineDates}
            selectedIndex={timelineIndex}
            onIndexChange={handleTimelineChange}
          />
        )}
      </div>

      <MapLegends
        layers={layers}
        hasRiverLevels={riverLevels.length > 0}
        hasPrecipitation={precipitation.length > 0}
        hasSoilMoisture={soilMoisture.length > 0}
        hasSnowData={snowData.length > 0}
        hasRunoffData={runoffData.length > 0}
        hasEarthquakes={earthquakes.length > 0}
        hasAiForecasts={aiStationKeys.size > 0}
      />

      {topAiThreat && (
        <AiAlertBanner
          {...topAiThreat}
          onOpen={() => {
            const match = effectiveRiverLevelsRef.current.find(
              (r) => r.riverName === topAiThreat.riverName && r.stationName === topAiThreat.stationName,
            );
            if (match) {
              mapViewRef.current?.flyTo(match.lng, match.lat, 12);
              handleMarkerClick("riverLevel", match);
            }
          }}
        />
      )}

      {(() => {
        // Top-of-map banner when the user is viewing a future day. Provides
        // an unambiguous "this isn't live" signal + one-tap escape back.
        const todayStr = new Date().toISOString().slice(0, 10);
        const selectedDate = timelineDates[timelineIndex];
        if (!selectedDate || selectedDate <= todayStr || timelineDates.length < 2) return null;
        const offset = Math.round(
          (new Date(selectedDate).getTime() - new Date(todayStr).getTime()) / 86_400_000,
        );
        const todayIdx = timelineDates.indexOf(todayStr);
        return (
          <ForecastBanner
            dateStr={selectedDate}
            offsetDays={offset}
            onReturnToNow={() => handleTimelineChange(todayIdx >= 0 ? todayIdx : 0)}
          />
        );
      })()}

      {!showReport && (
        <button
          className="fab"
          onClick={() => setShowReport(true)}
          aria-label="Сообщить о ситуации"
        >
          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          <span className="fab-label">Сообщить</span>
        </button>
      )}

      {showReport && createPortal(
        <>
          <div className="report-overlay-backdrop" onClick={() => setShowReport(false)} onTouchMove={(e) => e.preventDefault()} />
          <div className="report-overlay">
            <ReportForm
              onClose={() => setShowReport(false)}
              onCreated={(lat, lng) => {
                // Fly to the newly created item after a short delay for WebSocket marker to arrive
                setTimeout(() => mapViewRef.current?.flyTo(lng, lat, 15), 400);
              }}
            />
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

