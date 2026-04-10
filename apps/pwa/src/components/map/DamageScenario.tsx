// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import type { GaugeTier } from "./gaugeUtils.js";
import {
  getScenariosForRiver,
  formatNumber,
  formatDamage,
  type ScenarioLevel,
  type FloodScenario,
} from "./floodScenarios.js";
import type { ScenarioAwareness, ScenarioProximity, ProximityBarData } from "./scenarioAwareness.js";

// ── Info tooltip (tap-to-toggle, portal-based to escape overflow) ────────

function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const popupW = 260;
    let left = rect.left + rect.width / 2 - popupW / 2;
    // Clamp to viewport edges with 8px padding
    left = Math.max(8, Math.min(left, window.innerWidth - popupW - 8));
    setPos({ top: rect.top - 8, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open, updatePos]);

  return (
    <span className="info-tip">
      <button
        ref={btnRef}
        className="info-tip-btn"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        aria-label="Подробнее о расчёте"
      >?</button>
      {open && pos && createPortal(
        <div
          ref={popupRef}
          className="info-tip-popup"
          style={{ top: pos.top, left: pos.left }}
        >{text}</div>,
        document.body,
      )}
    </span>
  );
}

const METHODOLOGY = {
  proximity:
    "Близость = (текущий расход − норма) / (порог сценария − норма). " +
    "Метод EFAS (Kellens et al., 2013). Норма — среднегодовой расход станции.",
  returnPeriod:
    "Период повторяемости оценён методом Гумбеля (экстремальное распределение). " +
    "Используются пороги сценариев как якорные точки. Показывается только при близости ≥ 15% к первому порогу.",
  timeToThreshold:
    "Линейная экстраполяция по последним 3 наблюдениям (метод UK Environment Agency). " +
    "Показывается только при восходящем тренде.",
  probability:
    "Вероятность наступления за 10 лет: P = 1 − (1 − 1/T)^10, " +
    "где T — период повторяемости сценария.",
  cardProximity:
    "Процент приближения текущего расхода к порогу данного сценария. " +
    "0% = на уровне нормы, 100% = порог достигнут.",
} as const;

interface DamageScenarioProps {
  riverName: string;
  currentTier: GaugeTier;
  awareness: ScenarioAwareness | null;
}

const TAB_LABELS: Record<ScenarioLevel, string> = {
  moderate: "Умеренный",
  severe: "Серьёзный",
  catastrophic: "Катастроф.",
};

function defaultTab(tier: GaugeTier, available: ScenarioLevel[]): ScenarioLevel {
  if (tier.tier >= 4 && available.includes("catastrophic")) return "catastrophic";
  if (tier.tier >= 3 && available.includes("severe")) return "severe";
  return available[0];
}

// ── Proximity Bar sub-component ───────────────────────────────────────────

function ProximityBar({ awareness }: { awareness: ScenarioAwareness }) {
  const { barData, returnPeriod, timeToThreshold } = awareness;
  const { baseline, current, forecastPeak, thresholds, barMax } = barData;

  const pctOf = (v: number) => Math.max(0, Math.min(((v - baseline) / (barMax - baseline)) * 100, 100));

  const currentPct = pctOf(current);
  const forecastPct = forecastPeak !== null ? pctOf(forecastPeak) : null;

  // Check if any threshold is off-scale (beyond barMax)
  const hasOffscale = thresholds.some((t) => t.value > barMax);

  // Determine fill class — exceeded if past any threshold
  const anyExceeded = awareness.proximities.some((p) => p.isExceeded);
  const fillClass = anyExceeded ? "proximity-fill proximity-fill--exceeded" : "proximity-fill";

  const unit = barData.mode === "discharge" ? "м\u00B3/с" : "см";

  return (
    <div className="proximity-section">
      <div className="proximity-header">
        <span className="proximity-title">
          Близость к порогам <InfoTip text={METHODOLOGY.proximity} />
        </span>
        <span className="proximity-current">
          {formatNumber(Math.round(current))} {unit}
        </span>
      </div>

      <div className="proximity-track">
        {/* Filled portion */}
        <div className={fillClass} style={{ width: `${currentPct}%` }} />

        {/* Threshold tick marks */}
        {thresholds.map((t) =>
          t.value <= barMax ? (
            <div
              key={t.scenarioId}
              className={`proximity-threshold proximity-threshold--${t.scenarioId}`}
              style={{ left: `${pctOf(t.value)}%` }}
            >
              <span className="proximity-threshold-label">
                {formatNumber(t.value)}
              </span>
            </div>
          ) : null,
        )}

        {/* Off-scale marker */}
        {hasOffscale && (
          <span className="proximity-threshold-offscale">{">>"}</span>
        )}

        {/* Current position marker */}
        <div className="proximity-marker-current" style={{ left: `${currentPct}%` }} />

        {/* Forecast peak marker */}
        {forecastPct !== null && forecastPeak !== null && forecastPeak > current && (
          <div className="proximity-marker-forecast" style={{ left: `${forecastPct}%` }} />
        )}
      </div>

      {/* Meta row: return period + time-to-threshold */}
      {(returnPeriod || timeToThreshold) && (
        <div className="proximity-meta">
          <span className="proximity-return-period">
            {returnPeriod ? (
              <>{returnPeriod.label} <InfoTip text={METHODOLOGY.returnPeriod} /></>
            ) : ""}
          </span>
          {timeToThreshold && (
            <span className="proximity-eta">
              <span className="proximity-eta-arrow">{"\u2191"}</span>
              {timeToThreshold.etaLabel} до {"\u00AB"}{timeToThreshold.targetLabel}{"\u00BB"}
              {" "}<InfoTip text={METHODOLOGY.timeToThreshold} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Scenario Card sub-component ───────────────────────────────────────────

function ScenarioCard({
  s,
  proximity,
}: {
  s: FloodScenario;
  proximity: ScenarioProximity | undefined;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`damage-card damage-card--${s.scenarioId}`}>
      {/* Per-card proximity indicator */}
      {proximity && (
        <div className="damage-card-proximity">
          <div className="damage-card-proximity-bar">
            <div
              className="damage-card-proximity-fill"
              style={{ width: `${Math.min(proximity.proximityPct, 100)}%` }}
            />
          </div>
          {proximity.isExceeded ? (
            <span className="damage-card-proximity-exceeded">ПРЕВЫШЕН</span>
          ) : (
            <span className="damage-card-proximity-text">
              {proximity.proximityPct}% до {formatNumber(proximity.thresholdM3s)} м{"\u00B3"}/с
              {" "}<InfoTip text={METHODOLOGY.cardProximity} />
            </span>
          )}
        </div>
      )}

      <div className="damage-card-header">
        <span className="damage-card-period">{s.returnPeriod}</span>
        <span className="damage-card-discharge">{formatNumber(s.peakDischargeM3s)} м³/с</span>
      </div>

      <div className="damage-stats">
        <div className="damage-stat">
          <span className="damage-stat-icon" aria-hidden="true">👥</span>
          <span className="damage-stat-value">{formatNumber(s.populationAtRisk)}</span>
          <span className="damage-stat-label">чел. в зоне риска</span>
        </div>
        <div className="damage-stat">
          <span className="damage-stat-icon" aria-hidden="true">🏠</span>
          <span className="damage-stat-value">{formatNumber(s.buildingsAtRisk)}</span>
          <span className="damage-stat-label">зданий</span>
        </div>
        <div className="damage-stat">
          <span className="damage-stat-icon" aria-hidden="true">🌾</span>
          <span className="damage-stat-value">{formatNumber(s.agricultureHa)}</span>
          <span className="damage-stat-label">га с/х угодий</span>
        </div>
        <div className="damage-stat">
          <span className="damage-stat-icon" aria-hidden="true">🛤</span>
          <span className="damage-stat-value">{s.infrastructureItems.length}</span>
          <span className="damage-stat-label">объектов инфр.</span>
        </div>
      </div>

      <div className="damage-cost">
        <span className="damage-cost-value">{formatDamage(s.estimatedDamageRub)}</span>
        <span className="damage-cost-label">оценка ущерба</span>
      </div>

      {s.keySettlements.length > 0 && (
        <div className="damage-settlements">
          <span className="damage-settlements-label">Нас. пункты:</span>{" "}
          {s.keySettlements.join(", ")}
        </div>
      )}

      {s.historicalAnalogue && (
        <div className="damage-analogue">
          Аналог: {s.historicalAnalogue}
        </div>
      )}

      <div className="damage-probability">
        <div className="damage-probability-bar">
          <div
            className="damage-probability-fill"
            style={{ width: `${Math.max(s.probability10yr * 100, 2)}%` }}
          />
        </div>
        <span className="damage-probability-text">
          {Math.round(s.probability10yr * 100)}% за 10 лет
          {" "}<InfoTip text={METHODOLOGY.probability} />
        </span>
      </div>

      <button
        className="damage-expand"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {expanded ? "Скрыть подробности \u25B2" : "Подробнее \u25BC"}
      </button>

      {expanded && (
        <div className="damage-details">
          <p className="damage-description">{s.description}</p>
          {s.infrastructureItems.length > 0 && (
            <ul className="damage-infra-list">
              {s.infrastructureItems.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export function DamageScenario({ riverName, currentTier, awareness }: DamageScenarioProps) {
  const scenarios = useMemo(() => getScenariosForRiver(riverName), [riverName]);
  const availableLevels = useMemo(
    () => scenarios.map((s) => s.scenarioId) as ScenarioLevel[],
    [scenarios],
  );

  const [activeTab, setActiveTab] = useState<ScenarioLevel>(() =>
    availableLevels.length > 0 ? defaultTab(currentTier, availableLevels) : "moderate",
  );

  if (scenarios.length === 0) return null;

  const activeScenario = scenarios.find((s) => s.scenarioId === activeTab);

  // Find proximity data for active scenario
  const activeProximity = awareness?.proximities.find((p) => p.scenarioId === activeTab);

  return (
    <div className="damage-scenario">
      <div className="damage-scenario-title">Потенциальный ущерб</div>

      {/* Proximity bar — dynamic scenario awareness */}
      {awareness && <ProximityBar awareness={awareness} />}

      <div className="damage-tabs">
        {availableLevels.map((level) => {
          const prox = awareness?.proximities.find((p) => p.scenarioId === level);
          const isPulse = awareness?.shouldPulse && awareness.nearestScenarioId === level;

          return (
            <button
              key={level}
              className={[
                "damage-tab",
                `damage-tab--${level}`,
                activeTab === level ? "damage-tab--active" : "",
                isPulse ? "damage-tab--pulse" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => setActiveTab(level)}
            >
              {TAB_LABELS[level]}
              {prox && (
                <span className="damage-tab-proximity">{prox.proximityPct}%</span>
              )}
            </button>
          );
        })}
      </div>

      {activeScenario && (
        <ScenarioCard s={activeScenario} proximity={activeProximity} />
      )}
    </div>
  );
}
