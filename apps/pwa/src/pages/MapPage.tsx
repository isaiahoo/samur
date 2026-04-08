// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useCallback, useRef } from "react";
import type { Incident, HelpRequest, Shelter, RiverLevel } from "@samur/shared";
import {
  INCIDENT_TYPE_LABELS,
  SEVERITY_LABELS,
  HELP_CATEGORY_LABELS,
  URGENCY_LABELS,
  SHELTER_STATUS_LABELS,
  AMENITY_LABELS,
  RIVER_TREND_LABELS,
} from "@samur/shared";
import { formatRelativeTime } from "@samur/shared";
import { MapView } from "../components/map/MapView.js";
import { LayerToggle } from "../components/map/LayerToggle.js";
import { ReportForm } from "../components/map/ReportForm.js";
import { UrgencyBadge } from "../components/UrgencyBadge.js";
import { getIncidents, getHelpRequests, getShelters, getRiverLevels } from "../services/api.js";
import { cacheItems, getCachedItems } from "../services/db.js";
import { useSocketEvent, useSocketSubscription } from "../hooks/useSocket.js";
import { useGeolocation } from "../hooks/useGeolocation.js";
import { useOnline } from "../hooks/useOnline.js";
import { useUIStore } from "../store/ui.js";

type MapBounds = { north: number; south: number; east: number; west: number };

export function MapPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [helpRequests, setHelpRequests] = useState<HelpRequest[]>([]);
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [riverLevels, setRiverLevels] = useState<RiverLevel[]>([]);
  const [showReport, setShowReport] = useState(false);
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<{ type: string; data: unknown } | null>(null);

  const [layers, setLayers] = useState(() => ({
    incidents: true,
    helpRequests: true,
    shelters: true,
    riverLevels: true,
  }));

  const boundsRef = useRef<MapBounds | null>(null);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const online = useOnline();
  const { position, requestPosition } = useGeolocation();
  const openSheet = useUIStore((s) => s.openSheet);
  const closeSheet = useUIStore((s) => s.closeSheet);

  useSocketSubscription(position?.lat ?? null, position?.lng ?? null, 50000);

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

      const [incRes, hrRes, shRes, rlRes] = await Promise.all([
        getIncidents({ ...params, status: "unverified" }).catch(() => null),
        getHelpRequests({ ...params, status: "open" }).catch(() => null),
        getShelters({ limit: 100 }).catch(() => null),
        getRiverLevels({ latest: true }).catch(() => null),
      ]);

      const incData = (incRes?.data ?? []) as Incident[];
      const hrData = (hrRes?.data ?? []) as HelpRequest[];
      const shData = (shRes?.data ?? []) as Shelter[];
      const rlData = (rlRes?.data ?? []) as RiverLevel[];

      setIncidents(incData);
      setHelpRequests(hrData);
      setShelters(shData);
      setRiverLevels(rlData);

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

  // Initial data fetch
  useEffect(() => {
    fetchData();
    return () => { if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current); };
  }, [fetchData]);

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

  const handleMarkerClick = useCallback(
    (type: string, item: unknown) => {
      setSelectedItem({ type, data: item });
      openSheet(<DetailPanel type={type} data={item} onClose={closeSheet} />);
    },
    [openSheet, closeSheet],
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
  ];

  return (
    <div className="map-page">
      <MapView
        incidents={incidents}
        helpRequests={helpRequests}
        shelters={shelters}
        riverLevels={riverLevels}
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
  onClose,
}: {
  type: string;
  data: unknown;
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
    const r = data as RiverLevel;
    const pct = Math.round((r.levelCm / r.dangerLevelCm) * 100);
    return (
      <div className="detail-panel">
        <h3>{r.riverName} — {r.stationName}</h3>
        <div className="river-level-bar">
          <div
            className="river-level-fill"
            style={{
              width: `${Math.min(pct, 100)}%`,
              backgroundColor: pct >= 100 ? "#EF4444" : pct >= 80 ? "#F97316" : "#3B82F6",
            }}
          />
        </div>
        <p>Уровень: {r.levelCm} см из {r.dangerLevelCm} см ({pct}%)</p>
        <p>Тренд: {RIVER_TREND_LABELS[r.trend]}</p>
        <p className="detail-meta">{formatRelativeTime(r.measuredAt)}</p>
      </div>
    );
  }

  return null;
}
