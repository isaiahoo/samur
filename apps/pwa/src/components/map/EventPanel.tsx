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

// ── Severity / urgency ordering ────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_COLORS: Record<string, string> = { critical: "#991B1B", high: "#DC2626", medium: "#F59E0B", low: "#22C55E" };

// ── Sheet drag / snap ──────────────────────────────────────────────────────

type SheetMode = "peek" | "half" | "full";
const SHEET_KEY = "ep-sheet-mode";
const MOBILE_BP = 768;

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

// ── Props ──────────────────────────────────────────────────────────────────

interface EventPanelProps {
  incidents: Incident[];
  helpRequests: HelpRequest[];
  shelters: Shelter[];
  riverLevels: RiverLevel[];
  earthquakes: EarthquakeEvent[];
  layers: Record<string, boolean>;
  isLoading?: boolean;
  onEventClick: (type: MarkerType, item: unknown, key: string) => void;
  onClose?: () => void;
}

// ── Collapsible section ────────────────────────────────────────────────────

function Section({ title, count, color, children }: { title: string; count: number; color: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  if (count === 0) return null;
  return (
    <div className="ep-section">
      <button className="ep-section-header" onClick={() => setOpen(!open)}>
        <span className="ep-section-indicator" style={{ background: color }} />
        <span className="ep-section-title">{title}</span>
        <span className="ep-section-count">{count}</span>
        <span className={`ep-section-chevron${open ? " ep-section-chevron--open" : ""}`}>&#9656;</span>
      </button>
      <div className={`ep-section-body${open ? " ep-section-body--open" : ""}`}>
        {children}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function EventPanel({ incidents, helpRequests, shelters, riverLevels, earthquakes, layers, isLoading, onEventClick, onClose }: EventPanelProps) {
  const crisisMode = useUIStore((s) => s.crisisMode);

  // Viewport height tracking (mobile-only sheet)
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

  const [sheetMode, setSheetMode] = useState<SheetMode>(readSheetMode);
  useEffect(() => {
    window.localStorage.setItem(SHEET_KEY, sheetMode);
  }, [sheetMode]);

  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragStartRef = useRef<{ y: number; baseHeight: number } | null>(null);

  const currentHeight = dragHeight ?? heightFor(sheetMode, vh);
  const isDragging = dragHeight !== null;

  // Mirror height to document root so FABs can read it
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
  const sortedIncidents = useMemo(
    () => [...incidents].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)).slice(0, 20),
    [incidents],
  );

  const sortedHelp = useMemo(
    () => [...helpRequests].sort((a, b) => (SEVERITY_ORDER[a.urgency] ?? 9) - (SEVERITY_ORDER[b.urgency] ?? 9)).slice(0, 20),
    [helpRequests],
  );

  const sortedRivers = useMemo(
    () => [...riverLevels]
      .map((r) => ({ r, tier: computeTier(r) }))
      .sort((a, b) => b.tier.tier - a.tier.tier || b.tier.pctOfMean - a.tier.pctOfMean)
      .slice(0, 20),
    [riverLevels],
  );

  const sortedEq = useMemo(
    () => [...earthquakes].sort((a, b) => b.magnitude - a.magnitude).slice(0, 20),
    [earthquakes],
  );

  const sortedShelters = useMemo(
    () => [...shelters]
      .sort((a, b) => (b.currentOccupancy / (b.capacity || 1)) - (a.currentOccupancy / (a.capacity || 1)))
      .slice(0, 20),
    [shelters],
  );

  const hasAny = (layers.incidents && incidents.length > 0)
    || (layers.helpRequests && helpRequests.length > 0)
    || (layers.riverLevels && riverLevels.length > 0)
    || (layers.earthquakes && earthquakes.length > 0)
    || (layers.shelters && shelters.length > 0);

  const totalCount = (layers.incidents ? incidents.length : 0)
    + (layers.helpRequests ? helpRequests.length : 0)
    + (layers.riverLevels ? riverLevels.length : 0)
    + (layers.earthquakes ? earthquakes.length : 0)
    + (layers.shelters ? shelters.length : 0);

  const rootClasses = ["ep"];
  if (crisisMode) rootClasses.push("ep--crisis");
  if (isDragging) rootClasses.push("ep--dragging");
  if (isMobile) rootClasses.push(`ep--${sheetMode}`);
  const rootStyle: CSSProperties = isMobile ? { height: `${currentHeight}px` } : {};

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
          <button className="ep-close" onClick={onClose} aria-label="Закрыть">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        )}
      </div>

      <div className="ep-body">
          {isLoading && !hasAny && (
            <div className="ep-loading">
              <div className="spinner" style={{ width: 18, height: 18 }} />
              <span>Загрузка…</span>
            </div>
          )}
          {!isLoading && !hasAny && <p className="ep-empty">Нет активных событий</p>}

          {/* ── Incidents ──────────────────────────────────────────── */}
          {layers.incidents && sortedIncidents.length > 0 && (
            <Section title="Инциденты" count={incidents.length} color="#EF4444">
              {sortedIncidents.map((inc) => (
                <button key={inc.id} className="ep-row" onClick={() => onEventClick("incident", inc, inc.id)}>
                  <span className="ep-row-stripe" style={{ background: SEVERITY_COLORS[inc.severity] ?? "#71717a" }} />
                  <span className="ep-row-body">
                    <span className="ep-row-title">{INCIDENT_TYPE_LABELS[inc.type] ?? inc.type}</span>
                    <span className="ep-row-sub">{inc.address || formatRelativeTime(inc.createdAt)}</span>
                  </span>
                </button>
              ))}
            </Section>
          )}

          {/* ── Help Requests ─────────────────────────────────────── */}
          {layers.helpRequests && sortedHelp.length > 0 && (
            <Section title="Запросы помощи" count={helpRequests.length} color="#8B5CF6">
              {sortedHelp.map((hr) => (
                <button key={hr.id} className="ep-row" onClick={() => onEventClick("helpRequest", hr, hr.id)}>
                  <span className="ep-row-stripe" style={{ background: SEVERITY_COLORS[hr.urgency] ?? "#71717a" }} />
                  <span className="ep-row-body">
                    <span className="ep-row-title">
                      {HELP_CATEGORY_LABELS[hr.category] ?? hr.category}
                      <span className="ep-row-tag">{hr.type === "offer" ? "помощь" : "нужна"}</span>
                    </span>
                    <span className="ep-row-sub">{hr.address || formatRelativeTime(hr.createdAt)}</span>
                  </span>
                </button>
              ))}
            </Section>
          )}

          {/* ── River Levels ──────────────────────────────────────── */}
          {layers.riverLevels && sortedRivers.length > 0 && (
            <Section title="Уровень рек" count={riverLevels.length} color="#3B82F6">
              {sortedRivers.map(({ r, tier }) => {
                const color = TIER_COLORS[tier.hasData ? tier.tier : "nodata"];
                return (
                  <button
                    key={`${r.riverName}::${r.stationName}`}
                    className="ep-row"
                    onClick={() => onEventClick("riverLevel", r, `${r.riverName}::${r.stationName}`)}
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
                      </span>
                    </span>
                    {tier.hasData && (
                      <span
                        className="ep-row-pill"
                        style={{ background: `${color}1a`, color }}
                      >
                        {tier.pctOfMean}%
                      </span>
                    )}
                  </button>
                );
              })}
            </Section>
          )}

          {/* ── Earthquakes ───────────────────────────────────────── */}
          {layers.earthquakes && sortedEq.length > 0 && (
            <Section title="Землетрясения" count={earthquakes.length} color="#F97316">
              {sortedEq.map((eq) => {
                const color = eq.magnitude >= 5 ? "#EF4444" : eq.magnitude >= 4 ? "#F97316" : "#EAB308";
                return (
                  <button key={eq.usgsId} className="ep-row" onClick={() => onEventClick("earthquake", eq, eq.usgsId)}>
                    <span className="ep-row-stripe" style={{ background: color }} />
                    <span className="ep-row-body">
                      <span className="ep-row-title">{eq.place}</span>
                      <span className="ep-row-sub">Глубина {eq.depth} км · {formatRelativeTime(eq.time)}</span>
                    </span>
                    <span className="ep-row-pill" style={{ background: `${color}1a`, color }}>
                      M{eq.magnitude}
                    </span>
                  </button>
                );
              })}
            </Section>
          )}

          {/* ── Shelters ──────────────────────────────────────────── */}
          {layers.shelters && sortedShelters.length > 0 && (
            <Section title="Убежища" count={shelters.length} color="#22C55E">
              {sortedShelters.map((s) => {
                const color = s.status === "open" ? "#22C55E" : s.status === "full" ? "#F59E0B" : "#a1a1aa";
                return (
                  <button key={s.id} className="ep-row" onClick={() => onEventClick("shelter", s, s.id)}>
                    <span className="ep-row-stripe" style={{ background: color }} />
                    <span className="ep-row-body">
                      <span className="ep-row-title">{s.name}</span>
                      <span className="ep-row-sub">{SHELTER_STATUS_LABELS[s.status]}</span>
                    </span>
                    <span className="ep-row-pill" style={{ background: `${color}1a`, color }}>
                      {s.currentOccupancy}/{s.capacity}
                    </span>
                  </button>
                );
              })}
            </Section>
          )}
        </div>
    </div>
  );
}
