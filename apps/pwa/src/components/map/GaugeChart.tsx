// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Recharts-based gauge station chart for the detail panel.
 *
 * Shows observed discharge/level as solid area, forecast as dashed area,
 * danger threshold as horizontal red line, mean as gray line,
 * typical range (mean ±30%) as a shaded band, and a vertical "now" line.
 */

import { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
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
  isForecast: boolean;
  measuredAt: string;
}

interface GaugeChartProps {
  /** Pre-fetched history data (avoids duplicate API calls) */
  history: HistoryPoint[];
  dangerLevelCm: number | null;
  dischargeMax: number | null;
  dischargeMean: number | null;
  mode: "cm" | "discharge";
}

interface ChartPoint {
  date: string;       // DD.MM
  dateISO: string;    // full ISO for tooltip
  value: number | null;
  forecast: number | null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}`;
}

function formatDateFull(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${d.getFullYear()}`;
}

function createTooltip(mode: "cm" | "discharge") {
  const unit = mode === "cm" ? "см" : "м³/с";

  return function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
    if (!active || !payload?.length) return null;

    const point = payload[0]?.payload as ChartPoint | undefined;
    if (!point) return null;

    const val = point.value ?? point.forecast;
    if (val === null || val === undefined) return null;

    const isForecast = point.forecast !== null && point.value === null;

    return (
      <div className="gauge-chart-tooltip">
        <div className="gauge-chart-tooltip-date">{point.dateISO ? formatDateFull(point.dateISO) : label}</div>
        <div className="gauge-chart-tooltip-value">
          {val.toFixed(1)} {unit}
          {isForecast && <span className="gauge-chart-tooltip-forecast"> (прогноз)</span>}
        </div>
      </div>
    );
  };
}

export function GaugeChart({
  history,
  dangerLevelCm,
  dischargeMax,
  dischargeMean,
  mode,
}: GaugeChartProps) {
  const { chartData, dangerVal, meanVal, todayDate } = useMemo(() => {
    const getValue = (p: HistoryPoint) =>
      mode === "cm" ? p.levelCm : p.dischargeCubicM;

    const danger = mode === "cm" ? (dangerLevelCm ?? 0) : (dischargeMax ?? 0);
    const mean = mode === "cm" ? 0 : (dischargeMean ?? 0);

    // Find today's date formatted
    const now = new Date();
    const today = formatDate(now.toISOString());

    const points: ChartPoint[] = history
      .filter((p) => {
        const v = getValue(p);
        return v !== null && v > 0;
      })
      .map((p) => {
        const v = getValue(p)!;
        return {
          date: formatDate(p.measuredAt),
          dateISO: p.measuredAt,
          value: p.isForecast ? null : v,
          forecast: p.isForecast ? v : null,
        };
      });

    // Connect observed to forecast: duplicate last observed point as first forecast
    if (points.length > 1) {
      const lastObserved = points.filter((p) => p.value !== null).at(-1);
      const firstForecast = points.find((p) => p.forecast !== null);
      if (lastObserved && firstForecast) {
        const idx = points.indexOf(firstForecast);
        // Insert a bridge point with both values
        points.splice(idx, 0, {
          date: lastObserved.date,
          dateISO: lastObserved.dateISO,
          value: lastObserved.value,
          forecast: lastObserved.value,
        });
      }
    }

    return { chartData: points, dangerVal: danger, meanVal: mean, todayDate: today };
  }, [history, mode, dangerLevelCm, dischargeMax, dischargeMean]);

  if (chartData.length < 2) return null;

  // Calculate Y domain to include danger line and mean range
  const allValues = chartData
    .flatMap((p) => [p.value, p.forecast])
    .filter((v): v is number => v !== null);
  const dataMin = Math.min(...allValues);
  const dataMax = Math.max(...allValues, dangerVal);
  const rangeMin = meanVal > 0 ? meanVal * 0.7 : dataMin * 0.8;
  const rangeMax = meanVal > 0 ? meanVal * 1.3 : 0;
  const yMin = Math.max(0, Math.floor(Math.min(dataMin * 0.85, rangeMin) / 10) * 10);
  const yMax = Math.ceil(Math.max(dataMax * 1.1, rangeMax, dangerVal * 1.05));

  const dangerLabel = mode === "cm" ? "опасный" : "макс.";
  const TooltipComponent = useMemo(() => createTooltip(mode), [mode]);

  return (
    <div className="gauge-chart-container">
      <p className="gauge-chart-label">7 дней — наблюдение + прогноз:</p>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
          {/* Typical range band (mean ±30%) */}
          {meanVal > 0 && (
            <ReferenceArea
              y1={meanVal * 0.7}
              y2={meanVal * 1.3}
              fill="#94A3B8"
              fillOpacity={0.1}
              ifOverflow="extendDomain"
            />
          )}

          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#94A3B8" }}
            tickLine={false}
            axisLine={{ stroke: "#E2E8F0" }}
            interval="preserveStartEnd"
            allowDuplicatedCategory={false}
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fontSize: 10, fill: "#94A3B8" }}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))}
          />

          <Tooltip content={<TooltipComponent />} />

          {/* Observed area */}
          <Area
            type="monotone"
            dataKey="value"
            stroke="#3B82F6"
            strokeWidth={2}
            fill="#3B82F6"
            fillOpacity={0.15}
            connectNulls={false}
            dot={false}
            activeDot={{ r: 4, stroke: "#3B82F6", fill: "#fff", strokeWidth: 2 }}
          />

          {/* Forecast area (dashed) */}
          <Area
            type="monotone"
            dataKey="forecast"
            stroke="#3B82F6"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            fill="#3B82F6"
            fillOpacity={0.08}
            connectNulls={false}
            dot={false}
            activeDot={{ r: 4, stroke: "#3B82F6", fill: "#fff", strokeWidth: 2 }}
          />

          {/* Danger threshold line */}
          {dangerVal > 0 && (
            <ReferenceLine
              y={dangerVal}
              stroke={TIER_COLORS[3]}
              strokeDasharray="6 3"
              strokeWidth={1.5}
              label={{
                value: dangerLabel,
                position: "right",
                fontSize: 10,
                fill: TIER_COLORS[3],
              }}
            />
          )}

          {/* Mean discharge line */}
          {meanVal > 0 && (
            <ReferenceLine
              y={meanVal}
              stroke="#94A3B8"
              strokeDasharray="3 3"
              strokeWidth={1}
              label={{
                value: "норма",
                position: "right",
                fontSize: 10,
                fill: "#94A3B8",
              }}
            />
          )}

          {/* Vertical "now" line */}
          <ReferenceLine
            x={todayDate}
            stroke="#1E293B"
            strokeWidth={1}
            strokeDasharray="3 2"
            label={{
              value: "сейчас",
              position: "top",
              fontSize: 10,
              fill: "#1E293B",
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="gauge-chart-legend">
        <span className="gauge-chart-legend-item">
          <span className="gauge-chart-legend-line gauge-chart-legend-line--observed" /> наблюдение
        </span>
        <span className="gauge-chart-legend-item">
          <span className="gauge-chart-legend-line gauge-chart-legend-line--forecast" /> прогноз
        </span>
        {dangerVal > 0 && (
          <span className="gauge-chart-legend-item">
            <span className="gauge-chart-legend-line gauge-chart-legend-line--danger" /> {dangerLabel}
          </span>
        )}
        {meanVal > 0 && (
          <span className="gauge-chart-legend-item">
            <span className="gauge-chart-legend-line gauge-chart-legend-line--mean" /> норма
          </span>
        )}
      </div>
    </div>
  );
}
