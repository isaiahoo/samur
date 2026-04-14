// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useMemo } from "react";
import type { Incident, HelpRequest, Shelter, RiverLevel, EarthquakeEvent } from "@samur/shared";
import {
  INCIDENT_TYPE_LABELS,
  HELP_CATEGORY_LABELS,
  SHELTER_STATUS_LABELS,
  formatRelativeTime,
} from "@samur/shared";
import { computeTier, TIER_LABELS, TIER_COLORS, trendArrow } from "./gaugeUtils.js";
import type { MarkerType } from "./MapView.js";

// ── Severity / urgency ordering ────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_COLORS: Record<string, string> = { critical: "#991B1B", high: "#DC2626", medium: "#F59E0B", low: "#22C55E" };

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

  return (
    <div className="ep">
      <div className="ep-header">
        <span className="ep-header-title">МОНИТОРИНГ</span>
        <span className="ep-header-line" />
        <span className="ep-header-count">{totalCount}</span>
        {onClose && (
          <button className="ep-close" onClick={onClose} aria-label="Закрыть">&#x2715;</button>
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
                  <span className="ep-row-badge" style={{ background: SEVERITY_COLORS[inc.severity] ?? "#71717a" }} />
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
                  <span className="ep-row-badge" style={{ background: SEVERITY_COLORS[hr.urgency] ?? "#71717a" }} />
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
              {sortedRivers.map(({ r, tier }) => (
                <button
                  key={`${r.riverName}::${r.stationName}`}
                  className="ep-row"
                  onClick={() => onEventClick("riverLevel", r, `${r.riverName}::${r.stationName}`)}
                >
                  <span className="ep-row-badge" style={{ background: TIER_COLORS[tier.hasData ? tier.tier : "nodata"] }} />
                  <span className="ep-row-body">
                    <span className="ep-row-title">
                      {r.riverName} · {r.stationName}
                      <span className="ep-row-arrow">{trendArrow(r.trend)}</span>
                    </span>
                    <span className="ep-row-sub">
                      {tier.hasData ? `${TIER_LABELS[tier.tier]} · ${tier.pctOfMean}%` : "Нет данных"}
                    </span>
                  </span>
                </button>
              ))}
            </Section>
          )}

          {/* ── Earthquakes ───────────────────────────────────────── */}
          {layers.earthquakes && sortedEq.length > 0 && (
            <Section title="Землетрясения" count={earthquakes.length} color="#F97316">
              {sortedEq.map((eq) => (
                <button key={eq.usgsId} className="ep-row" onClick={() => onEventClick("earthquake", eq, eq.usgsId)}>
                  <span className="ep-row-mag" style={{ color: eq.magnitude >= 5 ? "#EF4444" : eq.magnitude >= 4 ? "#F97316" : "#EAB308" }}>
                    M{eq.magnitude}
                  </span>
                  <span className="ep-row-body">
                    <span className="ep-row-title">{eq.place}</span>
                    <span className="ep-row-sub">Глубина {eq.depth} км · {formatRelativeTime(eq.time)}</span>
                  </span>
                </button>
              ))}
            </Section>
          )}

          {/* ── Shelters ──────────────────────────────────────────── */}
          {layers.shelters && sortedShelters.length > 0 && (
            <Section title="Убежища" count={shelters.length} color="#22C55E">
              {sortedShelters.map((s) => (
                <button key={s.id} className="ep-row" onClick={() => onEventClick("shelter", s, s.id)}>
                  <span className="ep-row-badge" style={{ background: s.status === "open" ? "#22C55E" : s.status === "full" ? "#F59E0B" : "#a1a1aa" }} />
                  <span className="ep-row-body">
                    <span className="ep-row-title">{s.name}</span>
                    <span className="ep-row-sub">
                      {SHELTER_STATUS_LABELS[s.status]} · {s.currentOccupancy}/{s.capacity}
                    </span>
                  </span>
                </button>
              ))}
            </Section>
          )}
        </div>
    </div>
  );
}
