// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useMemo } from "react";
import type { GaugeTier } from "./gaugeUtils.js";
import {
  getScenariosForRiver,
  formatNumber,
  formatDamage,
  type ScenarioLevel,
  type FloodScenario,
} from "./floodScenarios.js";

interface DamageScenarioProps {
  riverName: string;
  currentTier: GaugeTier;
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

function ScenarioCard({ s }: { s: FloodScenario }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`damage-card damage-card--${s.scenarioId}`}>
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
        </span>
      </div>

      <button
        className="damage-expand"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {expanded ? "Скрыть подробности ▲" : "Подробнее ▼"}
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

export function DamageScenario({ riverName, currentTier }: DamageScenarioProps) {
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

  return (
    <div className="damage-scenario">
      <div className="damage-scenario-title">Потенциальный ущерб</div>

      <div className="damage-tabs">
        {availableLevels.map((level) => (
          <button
            key={level}
            className={`damage-tab damage-tab--${level}${activeTab === level ? " damage-tab--active" : ""}`}
            onClick={() => setActiveTab(level)}
          >
            {TAB_LABELS[level]}
          </button>
        ))}
      </div>

      {activeScenario && <ScenarioCard s={activeScenario} />}
    </div>
  );
}
