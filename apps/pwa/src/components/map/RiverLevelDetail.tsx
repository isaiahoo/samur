// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useMemo } from "react";
import type { RiverLevel } from "@samur/shared";
import { formatRelativeTime } from "@samur/shared";
import { computeTier, trendArrow, TIER_ACTIONS, computeForecastWarning, checkUpstreamDanger } from "./gaugeUtils.js";
import { GaugeChart, type HistoryPoint } from "./GaugeChart.js";
import { DamageScenario } from "./DamageScenario.js";
import { computeScenarioAwareness } from "./scenarioAwareness.js";
import { getScenariosForRiver } from "./floodScenarios.js";
import { getRiverLevelHistory, getHistoricalStats, getHistoricalPeaks, getAiForecast } from "../../services/api.js";
import type { HistoricalStat, HistoricalPeak, AiForecastPoint } from "../../services/api.js";
import type { AiForecastPoint as ChartAiForecast } from "./GaugeChart.js";
import type { SoilMoisturePoint } from "./geoJsonHelpers.js";

/** Find nearest soil moisture grid point to a station (within ~50km) */
function findNearestMoisture(lat: number, lng: number, points: SoilMoisturePoint[]): SoilMoisturePoint | null {
  let best: SoilMoisturePoint | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    const dlat = p.lat - lat;
    const dlng = p.lng - lng;
    const dist = dlat * dlat + dlng * dlng;
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  // ~0.5 degree ~ 50km — skip if too far
  return bestDist < 0.25 ? best : null;
}

/** Soil moisture status — thresholds aligned with NOAA/NASA SMAP standards */
function moistureStatus(m: number): { label: string; className: string } {
  if (m >= 0.55) return { label: "Почва перенасыщена — критический риск паводка", className: "soil-status--critical" };
  if (m >= 0.45) return { label: "Почва насыщена — высокий риск", className: "soil-status--saturated" };
  if (m >= 0.35) return { label: "Влажность повышена", className: "soil-status--elevated" };
  if (m >= 0.20) return { label: "Нормальная влажность", className: "soil-status--normal" };
  return { label: "Сухая почва", className: "soil-status--dry" };
}

interface RiverLevelDetailProps {
  data: RiverLevel;
  allLevels: RiverLevel[];
  soilMoisture: SoilMoisturePoint[];
}

export function RiverLevelDetail({ data: r, allLevels, soilMoisture }: RiverLevelDetailProps) {
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const tier = computeTier(r);
  const arrow = trendArrow(r.trend);
  const upstreamWarning = useMemo(
    () => checkUpstreamDanger(r.riverName, r.stationName, tier, allLevels),
    [r.riverName, r.stationName, tier, allLevels],
  );
  const nearestMoisture = useMemo(
    () => findNearestMoisture(r.lat, r.lng, soilMoisture),
    [r.lat, r.lng, soilMoisture],
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

  // AI forecast data
  const [aiForecastData, setAiForecastData] = useState<AiForecastPoint[]>([]);

  // Historical data (AllRivers.info)
  const [histStats, setHistStats] = useState<HistoricalStat[]>([]);
  const [histPeaks, setHistPeaks] = useState<HistoricalPeak[]>([]);
  const [histExpanded, setHistExpanded] = useState(false);

  useEffect(() => {
    getHistoricalStats(r.riverName, r.stationName)
      .then((res) => setHistStats(res.data ?? []))
      .catch(() => {});
    getHistoricalPeaks(r.riverName, r.stationName, 5)
      .then((res) => setHistPeaks(res.data ?? []))
      .catch(() => {});
    // Fetch AI forecast (filtered for this station)
    getAiForecast()
      .then((res) => {
        const stationData = (res.data ?? []).filter(
          (d) => d.riverName === r.riverName && d.stationName === r.stationName,
        );
        setAiForecastData(stationData);
      })
      .catch(() => {});
  }, [r.riverName, r.stationName]);

  const todayStats = useMemo(() => {
    if (histStats.length === 0) return null;
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const doy = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return histStats.find((s) => s.dayOfYear === doy) ?? null;
  }, [histStats]);

  const chartAiForecast: ChartAiForecast[] = useMemo(() => {
    if (aiForecastData.length === 0 || !hasLevel) return [];
    return aiForecastData.map((d) => ({
      levelCm: d.levelCm,
      predictionLower: d.predictionLower,
      predictionUpper: d.predictionUpper,
      measuredAt: d.measuredAt,
    }));
  }, [aiForecastData, hasLevel]);

  const forecastWarning = useMemo(
    () => history.length > 0 ? computeForecastWarning(history, mode) : null,
    [history, mode],
  );

  const scenarios = useMemo(() => getScenariosForRiver(r.riverName), [r.riverName]);

  const awareness = useMemo(() => {
    if (scenarios.length === 0) return null;
    const baseline = (r.dischargeAnnualMean && r.dischargeAnnualMean > 0)
      ? r.dischargeAnnualMean
      : (r.dischargeMean && r.dischargeMean > 0 ? r.dischargeMean : 0);
    return computeScenarioAwareness(
      scenarios, r.dischargeCubicM, baseline, r.trend,
      history, mode, r.levelCm, r.dangerLevelCm,
    );
  }, [scenarios, r.dischargeCubicM, r.dischargeAnnualMean, r.dischargeMean,
      r.trend, history, mode, r.levelCm, r.dangerLevelCm]);

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
          {(() => {
            const diff = Math.round(tier.pctOfMean - 100);
            if (diff === 0) return "Норма";
            if (diff > 0) return `на ${diff}% выше нормы`;
            return `на ${Math.abs(diff)}% ниже нормы`;
          })()}
          <span className="tier-hero-sub">
            {arrow}
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

      {/* Soil moisture indicator */}
      {nearestMoisture && (
        <div className={`soil-status ${moistureStatus(nearestMoisture.moisture).className}`}>
          <span className="soil-status-icon">💧</span>
          <div className="soil-status-content">
            <span className="soil-status-label">{moistureStatus(nearestMoisture.moisture).label}</span>
            <span className="soil-status-value">{Math.round(nearestMoisture.moisture * 100)}%</span>
          </div>
        </div>
      )}

      {/* Technical details */}
      {hasData && <p className="detail-tech">{techText}</p>}

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
          historicalStats={histStats.length > 0 ? histStats : undefined}
          aiForecast={chartAiForecast.length > 0 ? chartAiForecast : undefined}
        />
      )}

      {/* Action text */}
      {hasData && (
        <div className={`tier-action tier-action--${tier.tier}`}>
          {TIER_ACTIONS[tier.tier]}
        </div>
      )}

      {/* Historical context (AllRivers.info) */}
      {histStats.length > 0 && (
        <div className="historical-section">
          <button
            className="historical-toggle"
            onClick={() => setHistExpanded(!histExpanded)}
          >
            <span>Исторические данные</span>
            <span className="historical-toggle-icon">{histExpanded ? "▲" : "▼"}</span>
          </button>

          {histExpanded && (
            <div className="historical-content">
              {todayStats && (
                <p className="historical-today">
                  На эту дату в среднем: <strong>{todayStats.avgCm} см</strong>{" "}
                  (мин: {todayStats.minCm}, макс: {todayStats.maxCm})
                </p>
              )}

              {histPeaks.length > 0 && (
                <div className="historical-peaks">
                  <p className="historical-peaks-title">Максимальные уровни:</p>
                  <ul className="historical-peaks-list">
                    {histPeaks.map((p) => (
                      <li key={p.date}>
                        <strong>{p.valueCm} см</strong> — {new Date(p.date).toLocaleDateString("ru-RU")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="historical-attribution">Данные: AllRivers.info</p>
            </div>
          )}
        </div>
      )}

      {/* Damage scenario */}
      {hasData && <DamageScenario riverName={r.riverName} currentTier={tier} awareness={awareness} />}

      {hasData && <p className="detail-meta">{formatRelativeTime(r.measuredAt)}</p>}
    </div>
  );
}
