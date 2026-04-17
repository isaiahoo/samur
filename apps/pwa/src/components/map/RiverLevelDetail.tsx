// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useCallback, useMemo } from "react";
import type { RiverLevel } from "@samur/shared";
import { formatRelativeTime } from "@samur/shared";
import { computeTier, trendArrow, TIER_ACTIONS, computeForecastWarning, checkUpstreamDanger, tierHeroText } from "./gaugeUtils.js";
import { GaugeChart, type HistoryPoint } from "./GaugeChart.js";
import { DamageScenario } from "./DamageScenario.js";
import { AiForecastPanel, isSeasonal } from "./AiForecastPanel.js";
import { computeScenarioAwareness } from "./scenarioAwareness.js";
import { getScenariosForRiver } from "./floodScenarios.js";
import { getRiverLevelHistory, getHistoricalStats, getHistoricalPeaks, getAiForecast, getAiSkill } from "../../services/api.js";
import type { HistoricalStat, HistoricalPeak, AiForecastPoint, AiSkillRow } from "../../services/api.js";
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
  const [historyError, setHistoryError] = useState(false);
  const [aiForecastData, setAiForecastData] = useState<AiForecastPoint[]>([]);
  const [aiMeta, setAiMeta] = useState<{
    tier?: "high" | "medium" | "low" | "none";
    source?: "live-observations" | "historical-imports" | "climatology" | "training-csv" | "unknown";
    ood?: import("../../services/api.js").AiOodWarning[];
  }>({});
  // Rolling accuracy — populated from /ai-skill when enough forecast
  // snapshots have matured against observed values to be meaningful.
  // Stays null for stations with no evaluation data yet.
  const [aiSkillRow, setAiSkillRow] = useState<AiSkillRow | null>(null);

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
  const [aiMode, setAiMode] = useState(false);
  const aiIsSeasonal = isSeasonal(aiMeta.source);

  const hasLevel = r.levelCm !== null && r.levelCm > 0;
  const hasDischarge = r.dischargeCubicM !== null && r.dischargeCubicM > 0;
  const hasData = hasLevel || hasDischarge;
  const baseMode = hasLevel ? "cm" as const : "discharge" as const;
  const mode = aiMode ? "cm" as const : baseMode;

  // Stale check — skip for seed records (no dataSource)
  const ageMs = Date.now() - new Date(r.measuredAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  const staleThreshold = r.dataSource === "open-meteo" ? 48 : 6;
  const warnThreshold = r.dataSource === "open-meteo" ? 24 : 2;
  const isStale = r.dataSource !== null && ageHours > warnThreshold;

  // Single fetch for both chart and forecast warning
  const fetchHistory = useCallback(() => {
    setHistoryLoading(true);
    setHistoryError(false);
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
      .catch(() => { setHistoryError(true); })
      .finally(() => setHistoryLoading(false));
  }, [r.riverName, r.stationName]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

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
    // Fetch AI forecast (filtered for this station) + per-station meta
    getAiForecast()
      .then((res) => {
        const stationData = (res.data ?? []).filter(
          (d) => d.riverName === r.riverName && d.stationName === r.stationName,
        );
        setAiForecastData(stationData);
        const key = `${r.riverName}::${r.stationName}`;
        const meta = res.meta?.skills?.[key];
        if (meta) setAiMeta({ tier: meta.tier, source: meta.source, ood: meta.ood });
        else setAiMeta({});
      })
      .catch(() => {});
    // Fetch rolling accuracy (/ai-skill). Pick the shortest-horizon row
    // with enough paired observations to be meaningful — t+1 if
    // available, else the best-n row. Never display a skill line backed
    // by fewer than 10 observations.
    getAiSkill(30)
      .then((res) => {
        const rows = (res.data ?? []).filter(
          (d) => d.riverName === r.riverName && d.stationName === r.stationName,
        );
        if (rows.length === 0) { setAiSkillRow(null); return; }
        const t1 = rows.find((d) => d.horizonDays === 1 && d.n >= 10);
        if (t1) { setAiSkillRow(t1); return; }
        const bestN = rows.reduce<AiSkillRow | null>((best, d) =>
          d.n >= 10 && (!best || d.n > best.n) ? d : best, null);
        setAiSkillRow(bestN);
      })
      .catch(() => setAiSkillRow(null));
  }, [r.riverName, r.stationName]);

  const todayStats = useMemo(() => {
    if (histStats.length === 0) return null;
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const doy = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return histStats.find((s) => s.dayOfYear === doy) ?? null;
  }, [histStats]);

  const chartAiForecast: ChartAiForecast[] = useMemo(() => {
    if (aiForecastData.length === 0) return [];
    return aiForecastData.map((d) => ({
      levelCm: d.levelCm,
      predictionLower: d.predictionLower,
      predictionUpper: d.predictionUpper,
      measuredAt: d.measuredAt,
    }));
  }, [aiForecastData]);

  // In AI mode, build history from AI predictions so chart has cm data to render
  const aiHistory: HistoryPoint[] = useMemo(() => {
    if (!aiMode || aiForecastData.length === 0) return [];
    return aiForecastData.map((d) => ({
      levelCm: d.levelCm,
      dangerLevelCm: d.dangerLevelCm ?? r.dangerLevelCm,
      dischargeCubicM: null,
      dischargeMean: null,
      dischargeMax: null,
      isForecast: true,
      measuredAt: d.measuredAt,
    }));
  }, [aiMode, aiForecastData, r.dangerLevelCm]);

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

      {/* Hero — reference-aware phrasing (danger vs mean vs tier-only) */}
      {hasData && tier.referenceMode !== "none" && (
        <div className={`tier-hero tier-hero--${tier.tier}`}>
          {tierHeroText(tier)}
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

      {aiForecastData.length > 0 && (
        <AiForecastPanel
          data={aiForecastData}
          dangerLevelCm={r.dangerLevelCm}
          skillTier={aiMeta.tier}
          inputsSource={aiMeta.source}
          ood={aiMeta.ood}
          skillRow={aiSkillRow}
        />
      )}

      {hasData && aiForecastData.filter((d) => (d.levelCm ?? 0) > 0).length >= 2 && (
        <div className="chart-mode-toggle">
          <div className="chart-mode-row">
            <button
              className={`chart-mode-btn ${!aiMode ? "chart-mode-btn--active" : ""}`}
              onClick={() => setAiMode(false)}
            >
              Расход (м³/с)
            </button>
            <button
              className={`chart-mode-btn ${aiMode ? "chart-mode-btn--ai" : ""}`}
              onClick={() => setAiMode(true)}
            >
              <span className="chart-mode-btn-dot" />
              Уровень (см)
            </button>
          </div>
          <p className="chart-mode-hint">
            {aiMode
              ? (aiIsSeasonal
                  ? "График показывает сезонную норму — датчик молчит"
                  : "График показывает прогноз уровня от Кунак AI")
              : "График показывает текущий расход по данным GloFAS"}
          </p>
        </div>
      )}

      {/* Chart */}
      {hasData && historyLoading && (
        <div className="gauge-chart-loading">
          <div className="spinner" style={{ width: 20, height: 20 }} />
          <span>Загрузка графика…</span>
        </div>
      )}
      {hasData && !historyLoading && historyError && (
        <div className="gauge-chart-error">
          <span>Не удалось загрузить график</span>
          <button className="gauge-chart-retry" onClick={fetchHistory}>Повторить</button>
        </div>
      )}
      {hasData && !historyLoading && !historyError && (aiMode ? aiHistory.length > 0 : history.length > 0) && (
        <GaugeChart
          history={aiMode ? aiHistory : history}
          dangerLevelCm={r.dangerLevelCm}
          dischargeMax={r.dischargeMax}
          dischargeMean={r.dischargeMean}
          mode={mode}
          historicalStats={!aiMode && histStats.length > 0 ? histStats : undefined}
          aiForecast={!aiMode && chartAiForecast.length > 0 ? chartAiForecast : undefined}
        />
      )}
      {hasData && !historyLoading && !historyError && (aiMode ? aiHistory.length === 0 : history.length === 0) && (
        <div className="gauge-chart-empty">Данные за 7 дней недоступны</div>
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
