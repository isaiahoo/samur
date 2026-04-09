// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { Incident, HelpRequest, Shelter, RiverLevel } from "@samur/shared";
import {
  INCIDENT_TYPE_LABELS,
  SEVERITY_LABELS,
  HELP_CATEGORY_LABELS,
  SHELTER_STATUS_LABELS,
  AMENITY_LABELS,
} from "@samur/shared";
import { formatRelativeTime } from "@samur/shared";
import { MapView } from "../components/map/MapView.js";
import { LayerToggle } from "../components/map/LayerToggle.js";
import { TimelineSlider } from "../components/map/TimelineSlider.js";
import { ReportForm } from "../components/map/ReportForm.js";
import { UrgencyBadge } from "../components/UrgencyBadge.js";
import { computeTier, trendArrow, TIER_ACTIONS, computeForecastWarning, checkUpstreamDanger } from "../components/map/gaugeUtils.js";
import { GaugeChart, type HistoryPoint } from "../components/map/GaugeChart.js";
import { getIncidents, getHelpRequests, getShelters, getRiverLevels, getRiverLevelHistory, getRiverLevelForecast, getPrecipitation } from "../services/api.js";
import type { PrecipitationPoint } from "../components/map/geoJsonHelpers.js";
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
  }));

  const boundsRef = useRef<MapBounds | null>(null);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { position, requestPosition } = useGeolocation();
  const openSheet = useUIStore((s) => s.openSheet);
  const closeSheet = useUIStore((s) => s.closeSheet);

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

  // Initial data fetch — river levels + precipitation + forecast loaded once, rest refetched on map move
  useEffect(() => {
    fetchData();
    fetchRiverLevels();
    fetchPrecipData();
    fetchForecastData();
    return () => { if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current); };
  }, [fetchData, fetchRiverLevels, fetchPrecipData, fetchForecastData]);

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

  const handleTimelineChange = useCallback((index: number) => {
    setTimelineIndex(index);
  }, []);

  const handleMarkerClick = useCallback(
    (type: string, item: unknown) => {
      openSheet(<DetailPanel type={type} data={item} allRiverLevels={effectiveRiverLevels} onClose={closeSheet} />);
    },
    [openSheet, closeSheet, effectiveRiverLevels],
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
  ];

  return (
    <div className="map-page">
      <MapView
        incidents={incidents}
        helpRequests={helpRequests}
        shelters={shelters}
        riverLevels={effectiveRiverLevels}
        precipitation={precipitation}
        layers={layers}
        onMarkerClick={handleMarkerClick}
        onMapMove={handleMapMove}
      />

      <div className="map-controls">
        <LayerToggle
          layers={layerConfigs}
          onToggle={toggleLayer}
          open={layerMenuOpen}
          onOpenChange={setLayerMenuOpen}
        />
      </div>

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
        <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
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

function DetailPanel({
  type,
  data,
  allRiverLevels,
  onClose,
}: {
  type: string;
  data: unknown;
  allRiverLevels?: RiverLevel[];
  onClose: () => void;
}) {
  if (type === "incident") {
    const inc = data as Incident;
    return (
      <div className="detail-panel">
        <div className="detail-header">
          <h3>{INCIDENT_TYPE_LABELS[inc.type] ?? inc.type}</h3>
          <UrgencyBadge value={inc.severity} kind="severity" />
        </div>
        <p className="detail-meta">{formatRelativeTime(inc.createdAt)}</p>
        {inc.address && <p>{inc.address}</p>}
        {inc.description && <p>{inc.description}</p>}
        <p className="text-muted">Статус: {SEVERITY_LABELS[inc.status] ?? inc.status}</p>
      </div>
    );
  }

  if (type === "helpRequest") {
    const hr = data as HelpRequest;
    return (
      <div className="detail-panel">
        <div className="detail-header">
          <h3>{HELP_CATEGORY_LABELS[hr.category] ?? hr.category}</h3>
          <UrgencyBadge value={hr.urgency} kind="urgency" />
        </div>
        <p className="detail-meta">
          {hr.type === "offer" ? "Предлагает помощь" : "Нужна помощь"} · {formatRelativeTime(hr.createdAt)}
        </p>
        {hr.address && <p>{hr.address}</p>}
        {hr.description && <p>{hr.description}</p>}
        {hr.contactName && <p>Контакт: {hr.contactName}</p>}
        {hr.contactPhone && (
          <a href={`tel:${hr.contactPhone}`} className="btn btn-primary" style={{ marginTop: 8 }}>
            Позвонить: {hr.contactPhone}
          </a>
        )}
      </div>
    );
  }

  if (type === "shelter") {
    const s = data as Shelter;
    const navUrl = `https://yandex.ru/maps/?rtext=~${s.lat},${s.lng}&rtt=auto`;
    return (
      <div className="detail-panel">
        <div className="detail-header">
          <h3>{s.name}</h3>
          <span className={`status-badge status-badge--${s.status}`}>
            {SHELTER_STATUS_LABELS[s.status]}
          </span>
        </div>
        <p>{s.address}</p>
        <p>Заполненность: {s.currentOccupancy} / {s.capacity}</p>
        {s.amenities.length > 0 && (
          <p>Удобства: {s.amenities.map((a) => AMENITY_LABELS[a] ?? a).join(", ")}</p>
        )}
        {s.contactPhone && (
          <a href={`tel:${s.contactPhone}`} className="btn btn-secondary" style={{ marginTop: 8 }}>
            {s.contactPhone}
          </a>
        )}
        <a href={navUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ marginTop: 8 }}>
          Построить маршрут
        </a>
      </div>
    );
  }

  if (type === "riverLevel") {
    return <RiverLevelDetail data={data as RiverLevel} allLevels={allRiverLevels ?? []} />;
  }

  return null;
}

function RiverLevelDetail({ data: r, allLevels }: { data: RiverLevel; allLevels: RiverLevel[] }) {
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const tier = computeTier(r);
  const arrow = trendArrow(r.trend);
  const upstreamWarning = useMemo(
    () => checkUpstreamDanger(r.riverName, r.stationName, tier, allLevels),
    [r.riverName, r.stationName, tier, allLevels],
  );
  const hasLevel = r.levelCm !== null && r.levelCm > 0;
  const hasDischarge = r.dischargeCubicM !== null && r.dischargeCubicM > 0;
  const hasData = hasLevel || hasDischarge;
  const mode = hasLevel ? "cm" as const : "discharge" as const;

  // Stale check — skip for seed records (no dataSource)
  const ageMs = Date.now() - new Date(r.measuredAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  const staleThreshold = r.dataSource === "open-meteo" ? 48 : 6;
  const warnThreshold = r.dataSource === "open-meteo" ? 24 : 2;
  const isStale = r.dataSource !== null && ageHours > warnThreshold;

  // Single fetch for both chart and forecast warning
  useEffect(() => {
    setHistoryLoading(true);
    getRiverLevelHistory(r.riverName, r.stationName, 7, true)
      .then((res) => {
        const data = (res.data ?? []).map((d) => ({
          levelCm: d.levelCm,
          dangerLevelCm: d.dangerLevelCm,
          dischargeCubicM: d.dischargeCubicM,
          dischargeMean: d.dischargeMean,
          dischargeMax: d.dischargeMax,
          isForecast: d.isForecast ?? false,
          measuredAt: d.measuredAt,
        }));
        setHistory(data);
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, [r.riverName, r.stationName]);

  const forecastWarning = useMemo(
    () => history.length > 0 ? computeForecastWarning(history, mode) : null,
    [history, mode],
  );

  // Technical details
  let techText = "";
  if (hasLevel) {
    techText = `Уровень: ${r.levelCm} / ${r.dangerLevelCm} см`;
  } else if (hasDischarge) {
    techText = `Расход: ${r.dischargeCubicM} м³/с`;
    if (r.dischargeMean) techText += ` (норма: ${r.dischargeMean})`;
  }

  return (
    <div className="detail-panel">
      <h3>{r.riverName} — {r.stationName}</h3>

      {/* Tier banner */}
      {hasData && (
        <div className={`tier-banner tier-banner--${tier.tier}`}>
          {tier.label}
        </div>
      )}

      {/* Hero percentage */}
      {hasData && tier.pctOfMean > 0 && (
        <div className={`tier-hero tier-hero--${tier.tier}`}>
          {tier.pctOfMean}%
          <span style={{ fontSize: 14, fontWeight: 500, color: "#64748b", marginLeft: 6 }}>
            от нормы {arrow}
          </span>
        </div>
      )}

      {isStale && (
        <p className="detail-stale">
          {ageHours > staleThreshold ? "Данные устарели" : "Данные не обновлялись"} ({Math.round(ageHours)}ч назад)
        </p>
      )}

      {/* Forecast warning */}
      {forecastWarning && (
        <div className={`forecast-warning forecast-warning--${forecastWarning.hasDanger ? "danger" : "elevated"}`}>
          {forecastWarning.text}
        </div>
      )}

      {/* Upstream danger warning */}
      {upstreamWarning && (
        <div className="upstream-warning">
          <span className="upstream-warning-icon">{"\u25B2"}</span>
          {upstreamWarning.text}
          <div className="upstream-warning-eta">Вода может дойти за 6-12 часов</div>
        </div>
      )}

      {/* Technical details */}
      {hasData && <p style={{ fontSize: 13, color: "#475569", margin: "8px 0" }}>{techText}</p>}

      {/* Recharts chart — observed + forecast + threshold lines */}
      {hasData && historyLoading && (
        <div className="gauge-chart-loading">Загрузка графика...</div>
      )}
      {hasData && !historyLoading && history.length > 0 && (
        <GaugeChart
          history={history}
          dangerLevelCm={r.dangerLevelCm}
          dischargeMax={r.dischargeMax}
          dischargeMean={r.dischargeMean}
          mode={mode}
        />
      )}

      {/* Action text */}
      {hasData && (
        <div className={`tier-action tier-action--${tier.tier}`}>
          {TIER_ACTIONS[tier.tier]}
        </div>
      )}

      {hasData && <p className="detail-meta">{formatRelativeTime(r.measuredAt)}</p>}
    </div>
  );
}
