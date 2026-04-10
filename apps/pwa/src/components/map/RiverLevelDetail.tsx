// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useMemo } from "react";
import type { RiverLevel } from "@samur/shared";
import { formatRelativeTime } from "@samur/shared";
import { computeTier, trendArrow, TIER_ACTIONS, computeForecastWarning, checkUpstreamDanger } from "./gaugeUtils.js";
import { GaugeChart, type HistoryPoint } from "./GaugeChart.js";
import { getRiverLevelHistory } from "../../services/api.js";
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
