// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useMemo, useEffect, useRef, useCallback, type CSSProperties } from "react";
import type { Incident, HelpRequest, Shelter, RiverLevel, EarthquakeEvent } from "@samur/shared";
import {
  INCIDENT_TYPE_LABELS,
  HELP_CATEGORY_LABELS,
  SHELTER_STATUS_LABELS,
  formatRelativeTime,
} from "@samur/shared";
import { computeTier, TIER_LABELS, TIER_COLORS } from "./gaugeUtils.js";
import type { MarkerType } from "./MapView.js";
import { useUIStore } from "../../store/ui.js";
import { haversineMeters, formatDistance } from "../../utils/distance.js";

// ── Severity / urgency ordering ────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_COLORS: Record<string, string> = { critical: "#991B1B", high: "#DC2626", medium: "#F59E0B", low: "#22C55E" };
/** Severity score (higher = more urgent) used to drive adaptive section ordering. */
const SEVERITY_SCORE: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

// ── Sheet drag / snap ──────────────────────────────────────────────────────

type SheetMode = "peek" | "half" | "full";
const SHEET_KEY = "ep-sheet-mode";
const OPEN_KEY = "ep-open-sections-v2";
const EXPAND_KEY = "ep-expand-sections";
const STREAM_KEY = "ep-active-stream";
const MOBILE_BP = 768;
const ROW_CAP = 20;

function readSheetMode(): SheetMode {
  if (typeof window === "undefined") return "half";
  const v = window.localStorage.getItem(SHEET_KEY);
  if (v === "peek" || v === "half" || v === "full") return v;
  return "half";
}

function heightFor(mode: SheetMode, vh: number): number {
  if (mode === "peek") return Math.max(140, Math.round(vh * 0.18));
  if (mode === "full") return Math.round(vh * 0.85);
  return Math.round(vh * 0.45);
}

function readJSONObject(key: string): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

// ── Icons ──────────────────────────────────────────────────────────────────

function TrendIcon({ trend }: { trend: string }) {
  const common = {
    width: 14, height: 14, viewBox: "0 0 24 24",
    fill: "none", stroke: "currentColor", strokeWidth: 2.25,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (trend === "rising") {
    return (
      <svg {...common} className="ep-row-trend ep-row-trend--up">
        <path d="M7 17l5-5 5 5" />
        <path d="M12 12V4" />
      </svg>
    );
  }
  if (trend === "falling") {
    return (
      <svg {...common} className="ep-row-trend ep-row-trend--down">
        <path d="M7 7l5 5 5-5" />
        <path d="M12 12v8" />
      </svg>
    );
  }
  return (
    <svg {...common} className="ep-row-trend">
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`ep-section-chevron${open ? " ep-section-chevron--open" : ""}`}
      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ── Section keys & metadata ────────────────────────────────────────────────

type SectionKey = "rivers" | "earthquakes" | "incidents" | "help" | "shelters";
type StreamKey = "all" | SectionKey;

const SECTION_TITLES: Record<SectionKey, string> = {
  rivers: "Уровень рек",
  earthquakes: "Землетрясения",
  incidents: "Инциденты",
  help: "Запросы помощи",
  shelters: "Убежища",
};
const SECTION_SHORT_TITLES: Record<SectionKey, string> = {
  rivers: "Реки",
  earthquakes: "Сейсмика",
  incidents: "Инциденты",
  help: "Помощь",
  shelters: "Убежища",
};
const SECTION_COLORS: Record<SectionKey, string> = {
  rivers: "#3B82F6",
  earthquakes: "#F97316",
  incidents: "#EF4444",
  help: "#8B5CF6",
  shelters: "#22C55E",
};
/** Default ordering when everything is quiet. */
const DEFAULT_ORDER: SectionKey[] = ["rivers", "earthquakes", "incidents", "help", "shelters"];

// ── Props ──────────────────────────────────────────────────────────────────

interface EventPanelProps {
  incidents: Incident[];
  helpRequests: HelpRequest[];
  shelters: Shelter[];
  riverLevels: RiverLevel[];
  earthquakes: EarthquakeEvent[];
  layers: Record<string, boolean>;
  userPos: { lat: number; lng: number } | null;
  isLoading?: boolean;
  onEventClick: (type: MarkerType, item: unknown, key: string) => void;
  onClose?: () => void;
}

// ── Collapsible section (controlled) ───────────────────────────────────────

function Section({
  sectionKey,
  title,
  count,
  color,
  open,
  onToggle,
  children,
}: {
  sectionKey: SectionKey;
  title: string;
  count: number;
  color: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  const bodyId = `ep-section-${sectionKey}-body`;
  return (
    <div className="ep-section">
      <button
        className="ep-section-header"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
      >
        <span className="ep-section-indicator" style={{ background: color }} />
        <span className="ep-section-title">{title}</span>
        <span className="ep-section-count">{count}</span>
        <ChevronIcon open={open} />
      </button>
      <div
        id={bodyId}
        className={`ep-section-body${open ? " ep-section-body--open" : ""}`}
        role="region"
      >
        {children}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function EventPanel({ incidents, helpRequests, shelters, riverLevels, earthquakes, layers, userPos, isLoading, onEventClick, onClose }: EventPanelProps) {
  const crisisMode = useUIStore((s) => s.crisisMode);

  // Viewport + mobile detection
  const [vh, setVh] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 800));
  const [isMobile, setIsMobile] = useState(() => (typeof window !== "undefined" ? window.innerWidth < MOBILE_BP : true));
  useEffect(() => {
    const handle = () => {
      setVh(window.innerHeight);
      setIsMobile(window.innerWidth < MOBILE_BP);
    };
    window.addEventListener("resize", handle);
    window.addEventListener("orientationchange", handle);
    return () => {
      window.removeEventListener("resize", handle);
      window.removeEventListener("orientationchange", handle);
    };
  }, []);

  // Draggable sheet mode
  const [sheetMode, setSheetMode] = useState<SheetMode>(readSheetMode);
  useEffect(() => {
    window.localStorage.setItem(SHEET_KEY, sheetMode);
  }, [sheetMode]);

  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragStartRef = useRef<{ y: number; baseHeight: number } | null>(null);

  const currentHeight = dragHeight ?? heightFor(sheetMode, vh);
  const isDragging = dragHeight !== null;

  useEffect(() => {
    if (!isMobile) {
      document.documentElement.style.removeProperty("--ep-visible-height");
      return;
    }
    document.documentElement.style.setProperty("--ep-visible-height", `${currentHeight}px`);
    return () => {
      document.documentElement.style.removeProperty("--ep-visible-height");
    };
  }, [currentHeight, isMobile]);

  const onHandleDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isMobile) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStartRef.current = { y: e.clientY, baseHeight: currentHeight };
    setDragHeight(currentHeight);
  }, [isMobile, currentHeight]);

  const onHandleMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const dy = dragStartRef.current.y - e.clientY;
    const min = heightFor("peek", vh);
    const max = heightFor("full", vh);
    const next = Math.max(min, Math.min(max, dragStartRef.current.baseHeight + dy));
    setDragHeight(next);
  }, [vh]);

  const onHandleUp = useCallback(() => {
    if (!dragStartRef.current) return;
    dragStartRef.current = null;
    const current = dragHeight ?? heightFor(sheetMode, vh);
    const modes: SheetMode[] = ["peek", "half", "full"];
    let best: SheetMode = "half";
    let bestDist = Infinity;
    for (const m of modes) {
      const d = Math.abs(heightFor(m, vh) - current);
      if (d < bestDist) { bestDist = d; best = m; }
    }
    setSheetMode(best);
    setDragHeight(null);
  }, [dragHeight, sheetMode, vh]);

  // Sorted (top-20) lists per section
  const sortedIncidents = useMemo(
    () => [...incidents].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)),
    [incidents],
  );
  const sortedHelp = useMemo(
    () => [...helpRequests].sort((a, b) => (SEVERITY_ORDER[a.urgency] ?? 9) - (SEVERITY_ORDER[b.urgency] ?? 9)),
    [helpRequests],
  );
  const sortedRivers = useMemo(
    () => [...riverLevels]
      .map((r) => ({ r, tier: computeTier(r) }))
      .sort((a, b) => b.tier.tier - a.tier.tier || b.tier.pctOfMean - a.tier.pctOfMean),
    [riverLevels],
  );
  const sortedEq = useMemo(
    () => [...earthquakes].sort((a, b) => b.magnitude - a.magnitude),
    [earthquakes],
  );
  const sortedShelters = useMemo(
    () => [...shelters]
      .sort((a, b) => (b.currentOccupancy / (b.capacity || 1)) - (a.currentOccupancy / (a.capacity || 1))),
    [shelters],
  );

  // Severity scores per section, used by adaptive ordering
  const severityByKey: Record<SectionKey, number> = useMemo(() => ({
    rivers: sortedRivers.length > 0 ? sortedRivers[0].tier.tier : 0,
    earthquakes: sortedEq.length > 0
      ? (sortedEq[0].magnitude >= 5 ? 4 : sortedEq[0].magnitude >= 4 ? 3 : sortedEq[0].magnitude >= 3 ? 2 : 1)
      : 0,
    incidents: sortedIncidents.length > 0 ? SEVERITY_SCORE[sortedIncidents[0].severity] ?? 1 : 0,
    help: sortedHelp.length > 0 ? SEVERITY_SCORE[sortedHelp[0].urgency] ?? 1 : 0,
    shelters: sortedShelters.length > 0
      ? (() => {
          const ratio = sortedShelters[0].currentOccupancy / (sortedShelters[0].capacity || 1);
          return ratio >= 0.9 ? 3 : ratio >= 0.5 ? 2 : 1;
        })()
      : 0,
  }), [sortedRivers, sortedEq, sortedIncidents, sortedHelp, sortedShelters]);

  const counts: Record<SectionKey, number> = {
    rivers: layers.riverLevels ? riverLevels.length : 0,
    earthquakes: layers.earthquakes ? earthquakes.length : 0,
    incidents: layers.incidents ? incidents.length : 0,
    help: layers.helpRequests ? helpRequests.length : 0,
    shelters: layers.shelters ? shelters.length : 0,
  };

  const activeKeys: SectionKey[] = DEFAULT_ORDER.filter((k) => counts[k] > 0);

  // Adaptive ordering: severity desc, then default order for ties
  const orderedKeys = useMemo(() => {
    return [...activeKeys].sort((a, b) => {
      const delta = severityByKey[b] - severityByKey[a];
      if (delta !== 0) return delta;
      return DEFAULT_ORDER.indexOf(a) - DEFAULT_ORDER.indexOf(b);
    });
  }, [activeKeys, severityByKey]);

  const topKey = orderedKeys[0] ?? null;

  // Stream filter chip state
  const [activeStream, setActiveStream] = useState<StreamKey>(() => {
    if (typeof window === "undefined") return "all";
    const v = window.localStorage.getItem(STREAM_KEY);
    if (v === "all" || v === "rivers" || v === "earthquakes" || v === "incidents" || v === "help" || v === "shelters") return v;
    return "all";
  });
  useEffect(() => {
    window.localStorage.setItem(STREAM_KEY, activeStream);
  }, [activeStream]);

  // Per-section open state (defaults: only topKey open). `explicitOpen` holds
  // only keys the user has toggled — everything else falls back to default.
  const [explicitOpen, setExplicitOpen] = useState<Record<string, boolean>>(readJSONObject(OPEN_KEY));
  useEffect(() => {
    try {
      window.localStorage.setItem(OPEN_KEY, JSON.stringify(explicitOpen));
    } catch {/* ignore */}
  }, [explicitOpen]);

  const isOpen = (k: SectionKey): boolean => {
    if (k in explicitOpen) return explicitOpen[k];
    // When a stream filter is active, auto-open the matching section
    if (activeStream === k) return true;
    return k === topKey;
  };
  const toggleOpen = (k: SectionKey) => {
    setExplicitOpen((prev) => ({ ...prev, [k]: !isOpen(k) }));
  };

  // "Показать все" expansion state per section (beyond the 20-row cap)
  const [expanded, setExpanded] = useState<Record<string, boolean>>(readJSONObject(EXPAND_KEY));
  useEffect(() => {
    try {
      window.localStorage.setItem(EXPAND_KEY, JSON.stringify(expanded));
    } catch {/* ignore */}
  }, [expanded]);
  const isExpanded = (k: SectionKey): boolean => !!expanded[k];
  const toggleExpanded = (k: SectionKey) => setExpanded((p) => ({ ...p, [k]: !p[k] }));

  // Body state (loading, empty)
  const hasAny = orderedKeys.length > 0;

  const totalCount = counts.rivers + counts.earthquakes + counts.incidents + counts.help + counts.shelters;

  // Root classes + style
  const rootClasses = ["ep"];
  if (crisisMode) rootClasses.push("ep--crisis");
  if (isDragging) rootClasses.push("ep--dragging");
  if (isMobile) rootClasses.push(`ep--${sheetMode}`);
  const rootStyle: CSSProperties = isMobile ? { height: `${currentHeight}px` } : {};

  // A11y — Escape closes, focus close on open
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!onClose) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  useEffect(() => {
    // Focus close button once on mount (keyboard users can Tab forward from here)
    closeBtnRef.current?.focus({ preventScroll: true });
  }, []);

  // Distance helper (captures userPos)
  const distanceFor = (lat: number | null | undefined, lng: number | null | undefined): string | null => {
    if (!userPos || lat == null || lng == null) return null;
    return formatDistance(haversineMeters(userPos.lat, userPos.lng, lat, lng));
  };

  // Section renderers — return the rows JSX for a given section key
  const renderSectionBody = (key: SectionKey): React.ReactNode => {
    const showAll = isExpanded(key);
    switch (key) {
      case "rivers": {
        const items = showAll ? sortedRivers : sortedRivers.slice(0, ROW_CAP);
        return (
          <>
            {items.map(({ r, tier }) => {
              const color = TIER_COLORS[tier.hasData ? tier.tier : "nodata"];
              const stationKey = `${r.riverName}::${r.stationName}`;
              const dist = distanceFor(r.lat, r.lng);
              return (
                <button
                  key={stationKey}
                  className="ep-row"
                  onClick={() => onEventClick("riverLevel", r, stationKey)}
                >
                  <span className="ep-row-stripe" style={{ background: color }} />
                  <span className="ep-row-body">
                    <span className="ep-row-title">
                      <span className="ep-row-title-text">{r.riverName} · {r.stationName}</span>
                      <TrendIcon trend={r.trend} />
                    </span>
                    <span className="ep-row-sub">
                      {tier.hasData ? TIER_LABELS[tier.tier] : "Нет данных"}
                      {r.measuredAt && ` · ${formatRelativeTime(r.measuredAt)}`}
                      {dist && ` · ${dist}`}
                    </span>
                  </span>
                  {tier.hasData && (
                    <span className="ep-row-pill" style={{ background: `${color}1a`, color }}>
                      {tier.pctOfMean}%
                    </span>
                  )}
                </button>
              );
            })}
            {sortedRivers.length > ROW_CAP && (
              <button className="ep-show-all" onClick={() => toggleExpanded("rivers")}>
                {showAll ? "Свернуть" : `Показать все (${sortedRivers.length})`}
              </button>
            )}
          </>
        );
      }
      case "earthquakes": {
        const items = showAll ? sortedEq : sortedEq.slice(0, ROW_CAP);
        return (
          <>
            {items.map((eq) => {
              const color = eq.magnitude >= 5 ? "#EF4444" : eq.magnitude >= 4 ? "#F97316" : "#EAB308";
              const dist = distanceFor(eq.lat, eq.lng);
              return (
                <button key={eq.usgsId} className="ep-row" onClick={() => onEventClick("earthquake", eq, eq.usgsId)}>
                  <span className="ep-row-stripe" style={{ background: color }} />
                  <span className="ep-row-body">
                    <span className="ep-row-title">{eq.place}</span>
                    <span className="ep-row-sub">
                      Глубина {eq.depth} км · {formatRelativeTime(eq.time)}
                      {dist && ` · ${dist}`}
                    </span>
                  </span>
                  <span className="ep-row-pill" style={{ background: `${color}1a`, color }}>
                    M{eq.magnitude}
                  </span>
                </button>
              );
            })}
            {sortedEq.length > ROW_CAP && (
              <button className="ep-show-all" onClick={() => toggleExpanded("earthquakes")}>
                {showAll ? "Свернуть" : `Показать все (${sortedEq.length})`}
              </button>
            )}
          </>
        );
      }
      case "incidents": {
        const items = showAll ? sortedIncidents : sortedIncidents.slice(0, ROW_CAP);
        return (
          <>
            {items.map((inc) => {
              const dist = distanceFor(inc.lat, inc.lng);
              const parts: string[] = [];
              if (inc.address) parts.push(inc.address);
              parts.push(formatRelativeTime(inc.createdAt));
              if (dist) parts.push(dist);
              return (
                <button key={inc.id} className="ep-row" onClick={() => onEventClick("incident", inc, inc.id)}>
                  <span className="ep-row-stripe" style={{ background: SEVERITY_COLORS[inc.severity] ?? "#71717a" }} />
                  <span className="ep-row-body">
                    <span className="ep-row-title">{INCIDENT_TYPE_LABELS[inc.type] ?? inc.type}</span>
                    <span className="ep-row-sub">{parts.join(" · ")}</span>
                  </span>
                </button>
              );
            })}
            {sortedIncidents.length > ROW_CAP && (
              <button className="ep-show-all" onClick={() => toggleExpanded("incidents")}>
                {showAll ? "Свернуть" : `Показать все (${sortedIncidents.length})`}
              </button>
            )}
          </>
        );
      }
      case "help": {
        const items = showAll ? sortedHelp : sortedHelp.slice(0, ROW_CAP);
        return (
          <>
            {items.map((hr) => {
              const dist = distanceFor(hr.lat, hr.lng);
              const parts: string[] = [];
              if (hr.address) parts.push(hr.address);
              parts.push(formatRelativeTime(hr.createdAt));
              if (dist) parts.push(dist);
              return (
                <button key={hr.id} className="ep-row" onClick={() => onEventClick("helpRequest", hr, hr.id)}>
                  <span className="ep-row-stripe" style={{ background: SEVERITY_COLORS[hr.urgency] ?? "#71717a" }} />
                  <span className="ep-row-body">
                    <span className="ep-row-title">
                      {HELP_CATEGORY_LABELS[hr.category] ?? hr.category}
                      <span className="ep-row-tag">{hr.type === "offer" ? "помощь" : "нужна"}</span>
                    </span>
                    <span className="ep-row-sub">{parts.join(" · ")}</span>
                  </span>
                </button>
              );
            })}
            {sortedHelp.length > ROW_CAP && (
              <button className="ep-show-all" onClick={() => toggleExpanded("help")}>
                {showAll ? "Свернуть" : `Показать все (${sortedHelp.length})`}
              </button>
            )}
          </>
        );
      }
      case "shelters": {
        const items = showAll ? sortedShelters : sortedShelters.slice(0, ROW_CAP);
        return (
          <>
            {items.map((s) => {
              const color = s.status === "open" ? "#22C55E" : s.status === "full" ? "#F59E0B" : "#a1a1aa";
              const dist = distanceFor(s.lat, s.lng);
              return (
                <button key={s.id} className="ep-row" onClick={() => onEventClick("shelter", s, s.id)}>
                  <span className="ep-row-stripe" style={{ background: color }} />
                  <span className="ep-row-body">
                    <span className="ep-row-title">{s.name}</span>
                    <span className="ep-row-sub">
                      {SHELTER_STATUS_LABELS[s.status]}
                      {dist && ` · ${dist}`}
                    </span>
                  </span>
                  <span className="ep-row-pill" style={{ background: `${color}1a`, color }}>
                    {s.currentOccupancy}/{s.capacity}
                  </span>
                </button>
              );
            })}
            {sortedShelters.length > ROW_CAP && (
              <button className="ep-show-all" onClick={() => toggleExpanded("shelters")}>
                {showAll ? "Свернуть" : `Показать все (${sortedShelters.length})`}
              </button>
            )}
          </>
        );
      }
    }
  };

  // Which section keys are visible under the current stream filter
  const visibleKeys = activeStream === "all" ? orderedKeys : orderedKeys.filter((k) => k === activeStream);

  return (
    <div className={rootClasses.join(" ")} style={rootStyle}>
      {isMobile && (
        <div
          className="ep-drag-handle"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          aria-hidden="true"
        >
          <div className="ep-drag-handle-bar" />
        </div>
      )}
      <div className="ep-header">
        <span className="ep-header-title">Мониторинг</span>
        <span className="ep-header-line" />
        <span className="ep-header-count">{totalCount}</span>
        {onClose && (
          <button ref={closeBtnRef} className="ep-close" onClick={onClose} aria-label="Закрыть">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        )}
      </div>

      {orderedKeys.length > 1 && (
        <div className="ep-streams" role="tablist" aria-label="Фильтр потоков">
          <button
            type="button"
            role="tab"
            aria-selected={activeStream === "all"}
            className={`ep-stream${activeStream === "all" ? " ep-stream--active" : ""}`}
            onClick={() => setActiveStream("all")}
          >
            Все
            <span className="ep-stream-count">{totalCount}</span>
          </button>
          {orderedKeys.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={activeStream === k}
              className={`ep-stream${activeStream === k ? " ep-stream--active" : ""}`}
              onClick={() => setActiveStream(k)}
              style={{ "--ep-stream-color": SECTION_COLORS[k] } as CSSProperties}
            >
              {SECTION_SHORT_TITLES[k]}
              <span className="ep-stream-count">{counts[k]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="ep-body">
        {isLoading && !hasAny && (
          <div className="ep-loading">
            <div className="spinner" style={{ width: 18, height: 18 }} />
            <span>Загрузка…</span>
          </div>
        )}
        {!isLoading && !hasAny && <p className="ep-empty">Нет активных событий</p>}

        {visibleKeys.map((k) => (
          <Section
            key={k}
            sectionKey={k}
            title={SECTION_TITLES[k]}
            count={counts[k]}
            color={SECTION_COLORS[k]}
            open={isOpen(k)}
            onToggle={() => toggleOpen(k)}
          >
            {renderSectionBody(k)}
          </Section>
        ))}
      </div>
    </div>
  );
}
