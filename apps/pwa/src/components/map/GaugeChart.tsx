// SPDX-License-Identifier: AGPL-3.0-only

/**
 * River gauge chart — USGS/EA-inspired design for regular users.
 *
 * Key design principles (from USGS, UK Environment Agency, EFAS):
 * - Colored horizontal danger-zone bands behind the data line
 * - Bold "Now" divider between observed (solid) and forecast (dashed)
 * - Fill color changes based on which zone the value is in
 * - Status-aware tooltip ("Normal" / "Elevated" / "Dangerous")
 * - Threshold labels on the chart, not in a separate legend
 */

import { useMemo, memo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  type TooltipProps,
} from "recharts";
import { TIER_COLORS } from "./gaugeUtils.js";

export interface HistoryPoint {
  levelCm: number | null;
  dangerLevelCm: number | null;
  dischargeCubicM: number | null;
  dischargeMean: number | null;
  dischargeMax: number | null;
  dischargeMedian?: number | null;
  dischargeMin?: number | null;
  dischargeP25?: number | null;
  dischargeP75?: number | null;
  isForecast: boolean;
  measuredAt: string;
}

export interface HistoricalStat {
  dayOfYear: number;
  avgCm: number;
  minCm: number;
  maxCm: number;
  p10Cm: number;
  p90Cm: number;
  sampleCount: number;
}

export interface AiForecastPoint {
  levelCm: number | null;
  predictionLower: number | null;
  predictionUpper: number | null;
  measuredAt: string;
}

interface GaugeChartProps {
  history: HistoryPoint[];
  dangerLevelCm: number | null;
  dischargeMax: number | null;
  dischargeMean: number | null;
  mode: "cm" | "discharge";
  historicalStats?: HistoricalStat[];
  aiForecast?: AiForecastPoint[];
}

interface ChartPoint {
  date: string;
  dateISO: string;
  value: number | null;
  forecast: number | null;
  p25: number | null;
  p75: number | null;
  histAvg: number | null;
  histP10: number | null;
  histP90: number | null;
  aiForecast: number | null;
  aiLower: number | null;
  aiUpper: number | null;
}

function getDayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatDateFull(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

// ── Status helper for values ────────────────────────────────────────────

function getValueStatus(
  val: number,
  meanVal: number,
  dangerVal: number,
  mode: "cm" | "discharge",
): { label: string; color: string } {
  if (mode === "cm") {
    if (dangerVal > 0 && val >= dangerVal) return { label: "Критический уровень", color: TIER_COLORS[4] };
    if (dangerVal > 0 && val >= dangerVal * 0.75) return { label: "Опасный уровень", color: TIER_COLORS[3] };
    if (dangerVal > 0 && val >= dangerVal * 0.5) return { label: "Повышенный", color: TIER_COLORS[2] };
    return { label: "Норма", color: TIER_COLORS[1] };
  }
  // Discharge mode
  if (dangerVal > 0 && val >= dangerVal) return { label: "Превышение максимума", color: TIER_COLORS[4] };
  if (meanVal > 0 && val >= meanVal * 2.5) return { label: "Критический", color: TIER_COLORS[4] };
  if (meanVal > 0 && val >= meanVal * 1.5) return { label: "Опасный расход", color: TIER_COLORS[3] };
  if (meanVal > 0 && val >= meanVal * 1.15) return { label: "Повышенный", color: TIER_COLORS[2] };
  return { label: "Норма", color: TIER_COLORS[1] };
}

// ── Tooltip ─────────────────────────────────────────────────────────────

function createTooltip(mode: "cm" | "discharge", meanVal: number, dangerVal: number) {
  const unit = mode === "cm" ? "см" : "м³/с";

  return function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
    if (!active || !payload?.length) return null;

    const point = payload[0]?.payload as ChartPoint | undefined;
    if (!point) return null;

    const val = point.value ?? point.forecast;
    if (val === null || val === undefined) return null;

    const isForecast = point.forecast !== null && point.value === null;
    const status = getValueStatus(val, meanVal, dangerVal, mode);

    return (
      <div className="gauge-chart-tooltip">
        <div className="gauge-chart-tooltip-date">{point.dateISO ? formatDateFull(point.dateISO) : label}</div>
        <div className="gauge-chart-tooltip-value">
          {val.toFixed(1)} {unit}
          {isForecast && <span className="gauge-chart-tooltip-forecast"> (прогноз)</span>}
        </div>
        <div className="gauge-chart-tooltip-status" style={{ color: status.color }}>
          {status.label}
        </div>
        {point.histAvg !== null && (
          <div className="gauge-chart-tooltip-hist">
            Историческое среднее: {point.histAvg} см
          </div>
        )}
        {point.aiForecast !== null && (
          <div className="gauge-chart-tooltip-ai">
            Кунак AI: {point.aiForecast.toFixed(1)} см
            {point.aiLower !== null && point.aiUpper !== null && (
              <> ({point.aiLower.toFixed(0)}–{point.aiUpper.toFixed(0)})</>
            )}
          </div>
        )}
      </div>
    );
  };
}

// ── Chart component ─────────────────────────────────────────────────────

export const GaugeChart = memo(function GaugeChart({
  history,
  dangerLevelCm,
  dischargeMax,
  dischargeMean,
  mode,
  historicalStats,
  aiForecast,
}: GaugeChartProps) {
  // Build a lookup map for historical stats by day-of-year
  const histByDoy = useMemo(() => {
    if (!historicalStats || historicalStats.length === 0 || mode !== "cm") return null;
    const m = new Map<number, HistoricalStat>();
    for (const s of historicalStats) m.set(s.dayOfYear, s);
    return m;
  }, [historicalStats, mode]);

  // Build AI forecast lookup by date
  const aiByDate = useMemo(() => {
    if (!aiForecast || aiForecast.length === 0 || mode !== "cm") return null;
    const m = new Map<string, AiForecastPoint>();
    for (const p of aiForecast) m.set(formatDate(p.measuredAt), p);
    return m;
  }, [aiForecast, mode]);

  const { chartData, dangerVal, meanVal, todayDate, elevatedVal, highVal } = useMemo(() => {
    const getValue = (p: HistoryPoint) =>
      mode === "cm" ? p.levelCm : p.dischargeCubicM;

    const danger = mode === "cm" ? (dangerLevelCm ?? 0) : (dischargeMax ?? 0);
    const mean = mode === "cm" ? 0 : (dischargeMean ?? 0);

    // Zone thresholds
    const elevated = mode === "cm"
      ? (danger > 0 ? danger * 0.5 : 0)
      : (mean > 0 ? mean * 1.15 : 0);
    const high = mode === "cm"
      ? (danger > 0 ? danger * 0.75 : 0)
      : (mean > 0 ? mean * 1.5 : 0);

    const now = new Date();
    const today = formatDate(now.toISOString());

    const points: ChartPoint[] = history
      .filter((p) => {
        const v = getValue(p);
        return v !== null && v > 0;
      })
      .map((p) => {
        const v = getValue(p)!;
        const doy = getDayOfYear(new Date(p.measuredAt));
        const hist = histByDoy?.get(doy);
        const dateKey = formatDate(p.measuredAt);
        const ai = aiByDate?.get(dateKey);
        return {
          date: dateKey,
          dateISO: p.measuredAt,
          value: p.isForecast ? null : v,
          forecast: p.isForecast ? v : null,
          p25: mode === "discharge" ? (p.dischargeP25 ?? null) : null,
          p75: mode === "discharge" ? (p.dischargeP75 ?? null) : null,
          histAvg: hist ? hist.avgCm : null,
          histP10: hist ? hist.p10Cm : null,
          histP90: hist ? hist.p90Cm : null,
          aiForecast: ai?.levelCm ?? null,
          aiLower: ai?.predictionLower ?? null,
          aiUpper: ai?.predictionUpper ?? null,
        };
      });

    // Connect observed to forecast: bridge point
    if (points.length > 1) {
      const lastObserved = points.filter((p) => p.value !== null).at(-1);
      const firstForecast = points.find((p) => p.forecast !== null);
      if (lastObserved && firstForecast) {
        const idx = points.indexOf(firstForecast);
        points.splice(idx, 0, {
          date: lastObserved.date,
          dateISO: lastObserved.dateISO,
          value: lastObserved.value,
          forecast: lastObserved.value,
          p25: lastObserved.p25,
          p75: lastObserved.p75,
          histAvg: lastObserved.histAvg,
          histP10: lastObserved.histP10,
          histP90: lastObserved.histP90,
          aiForecast: lastObserved.aiForecast,
          aiLower: lastObserved.aiLower,
          aiUpper: lastObserved.aiUpper,
        });
      }
    }

    return { chartData: points, dangerVal: danger, meanVal: mean, todayDate: today, elevatedVal: elevated, highVal: high };
  }, [history, mode, dangerLevelCm, dischargeMax, dischargeMean, histByDoy, aiByDate]);

  // All hooks must run unconditionally — any early return must come AFTER
  // the last hook, otherwise the hook-call count changes between renders
  // (e.g. toggling into AI mode on a station whose model only served one
  // forecast day, leaving chartData with a single point) and React throws.
  const TooltipComponent = useMemo(() => createTooltip(mode, meanVal, dangerVal), [mode, meanVal, dangerVal]);

  if (chartData.length < 2) return null;

  const hasObserved = chartData.some((p) => p.value !== null);
  const hasPercentiles = chartData.some((p) => p.p25 !== null && p.p75 !== null);
  const hasHistorical = chartData.some((p) => p.histAvg !== null);
  const hasAiForecast = chartData.some((p) => p.aiForecast !== null);

  // Y domain
  const allValues = chartData
    .flatMap((p) => [p.value, p.forecast, p.p25, p.p75, p.histP10, p.histP90, p.aiForecast, p.aiLower, p.aiUpper])
    .filter((v): v is number => v !== null);
  const dataMin = Math.min(...allValues);
  const dataMax = Math.max(...allValues, dangerVal);
  const yMin = Math.max(0, Math.floor(Math.min(dataMin * 0.8, meanVal > 0 ? meanVal * 0.7 : dataMin) / 10) * 10);
  const yMax = Math.ceil(Math.max(dataMax * 1.15, dangerVal * 1.1));

  return (
    <div className="gauge-chart-container">
      <div className="gauge-chart-header">
        <span className="gauge-chart-title">
          {mode === "cm" ? "Уровень воды (см)" : "Расход воды (м³/с)"} — 7 дней
        </span>
      </div>
      <ResponsiveContainer width="100%" height={210}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 8, bottom: 0, left: -12 }}>
          {/* ── Colored danger-zone bands (behind everything) ── */}

          {/* Green zone: 0 → elevated threshold */}
          {elevatedVal > 0 && (
            <ReferenceArea
              y1={yMin}
              y2={Math.min(elevatedVal, yMax)}
              fill={TIER_COLORS[1]}
              fillOpacity={0.06}
              ifOverflow="extendDomain"
            />
          )}

          {/* Yellow zone: elevated → high threshold */}
          {elevatedVal > 0 && highVal > 0 && (
            <ReferenceArea
              y1={elevatedVal}
              y2={Math.min(highVal, yMax)}
              fill={TIER_COLORS[2]}
              fillOpacity={0.08}
              ifOverflow="extendDomain"
            />
          )}

          {/* Red zone: high → danger */}
          {highVal > 0 && dangerVal > 0 && (
            <ReferenceArea
              y1={highVal}
              y2={Math.min(dangerVal, yMax)}
              fill={TIER_COLORS[3]}
              fillOpacity={0.08}
              ifOverflow="extendDomain"
            />
          )}

          {/* Dark red zone: above danger */}
          {dangerVal > 0 && dangerVal < yMax && (
            <ReferenceArea
              y1={dangerVal}
              y2={yMax}
              fill={TIER_COLORS[4]}
              fillOpacity={0.10}
              ifOverflow="extendDomain"
            />
          )}

          {/* Typical range band (p25-p75 or synthetic) */}
          {hasPercentiles ? (
            <>
              <Area
                type="monotone"
                dataKey="p75"
                stroke="none"
                fill="#a1a1aa"
                fillOpacity={0.10}
                connectNulls
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="p25"
                stroke="none"
                fill="#fff"
                fillOpacity={1}
                connectNulls
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            </>
          ) : meanVal > 0 ? (
            <ReferenceArea
              y1={meanVal * 0.7}
              y2={meanVal * 1.3}
              fill="#a1a1aa"
              fillOpacity={0.08}
              ifOverflow="extendDomain"
            />
          ) : null}

          {/* Historical p10-p90 band (cm mode only) */}
          {hasHistorical && (
            <>
              <Area
                type="monotone"
                dataKey="histP90"
                stroke="none"
                fill="#8b5cf6"
                fillOpacity={0.08}
                connectNulls
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="histP10"
                stroke="none"
                fill="#fff"
                fillOpacity={1}
                connectNulls
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="histAvg"
                stroke="#8b5cf6"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                activeDot={false}
                connectNulls
                isAnimationActive={false}
              />
            </>
          )}

          {/* AI forecast confidence band + line (cm mode only) */}
          {hasAiForecast && (
            <>
              <Area
                type="monotone"
                dataKey="aiUpper"
                stroke="none"
                fill="#14b8a6"
                fillOpacity={0.10}
                connectNulls
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="aiLower"
                stroke="none"
                fill="#fff"
                fillOpacity={1}
                connectNulls
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="aiForecast"
                stroke="#14b8a6"
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
                activeDot={{ r: 4, stroke: "#14b8a6", fill: "#fff", strokeWidth: 2 }}
                connectNulls
                isAnimationActive={false}
              />
            </>
          )}

          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#71717a" }}
            tickLine={false}
            axisLine={{ stroke: "#e4e4e7" }}
            interval="preserveStartEnd"
            allowDuplicatedCategory={false}
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fontSize: 10, fill: "#71717a" }}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))}
          />

          <Tooltip content={<TooltipComponent />} />

          {/* Observed line — solid, with gradient fill */}
          <Area
            type="monotone"
            dataKey="value"
            stroke="#2563EB"
            strokeWidth={2.5}
            fill="url(#observedGradient)"
            fillOpacity={1}
            connectNulls={false}
            dot={false}
            activeDot={{ r: 5, stroke: "#2563EB", fill: "#fff", strokeWidth: 2 }}
          />

          {/* Forecast — dashed line, lighter fill */}
          <Area
            type="monotone"
            dataKey="forecast"
            stroke="#60A5FA"
            strokeWidth={2}
            strokeDasharray="6 4"
            fill="url(#forecastGradient)"
            fillOpacity={1}
            connectNulls={false}
            dot={false}
            activeDot={{ r: 4, stroke: "#60A5FA", fill: "#fff", strokeWidth: 2 }}
          />

          {/* Danger threshold — bold red line with label */}
          {dangerVal > 0 && (
            <ReferenceLine
              y={dangerVal}
              stroke={TIER_COLORS[3]}
              strokeDasharray="8 4"
              strokeWidth={2}
              label={{
                value: mode === "cm" ? "⚠ Опасный уровень" : "⚠ Максимум",
                position: "insideTopRight",
                fontSize: 10,
                fontWeight: 600,
                fill: TIER_COLORS[3],
                offset: 4,
              }}
            />
          )}

          {/* Norm line — subtle with label */}
          {meanVal > 0 && (
            <ReferenceLine
              y={meanVal}
              stroke="#a1a1aa"
              strokeDasharray="4 4"
              strokeWidth={1}
              label={{
                value: "Норма",
                position: "insideBottomRight",
                fontSize: 10,
                fill: "#71717a",
                offset: 4,
              }}
            />
          )}

          {/* "NOW" vertical line — prominent */}
          <ReferenceLine
            x={todayDate}
            stroke="#27272a"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            label={{
              value: "Сейчас",
              position: "top",
              fontSize: 11,
              fontWeight: 600,
              fill: "#27272a",
            }}
          />

          {/* Gradient definitions */}
          <defs>
            <linearGradient id="observedGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563EB" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#2563EB" stopOpacity={0.03} />
            </linearGradient>
            <linearGradient id="forecastGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60A5FA" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#60A5FA" stopOpacity={0.02} />
            </linearGradient>
          </defs>
        </ComposedChart>
      </ResponsiveContainer>

      {/* Compact legend — inline with color dots */}
      <div className="gauge-chart-legend">
        {hasObserved && (
          <span className="gauge-chart-legend-item">
            <span className="gauge-chart-legend-dot" style={{ background: "#2563EB" }} /> Факт
          </span>
        )}
        <span className="gauge-chart-legend-item">
          <span className="gauge-chart-legend-dot gauge-chart-legend-dot--dashed" /> Прогноз
        </span>
        {dangerVal > 0 && (
          <span className="gauge-chart-legend-item">
            <span className="gauge-chart-legend-dot" style={{ background: TIER_COLORS[3] }} /> {mode === "cm" ? "Опасный" : "Максимум"}
          </span>
        )}
        {meanVal > 0 && (
          <span className="gauge-chart-legend-item">
            <span className="gauge-chart-legend-dot" style={{ background: "#a1a1aa" }} /> Норма
          </span>
        )}
        {hasHistorical && (
          <span className="gauge-chart-legend-item">
            <span className="gauge-chart-legend-dot" style={{ background: "#8b5cf6" }} /> Историческая норма
          </span>
        )}
        {hasAiForecast && (
          <span className="gauge-chart-legend-item">
            <span className="gauge-chart-legend-dot" style={{ background: "#14b8a6" }} /> Кунак AI
          </span>
        )}
      </div>
    </div>
  );
});
