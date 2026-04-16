// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AI Forecast Panel — displays Самур AI predictions in a clear,
 * actionable format inspired by UK Environment Agency, Google Flood Hub,
 * and Varsom.no patterns.
 */

import { useMemo } from "react";
import type { AiForecastPoint, AiSkillTier, AiInputsSource } from "../../services/api.js";

interface AiForecastPanelProps {
  data: AiForecastPoint[];
  dangerLevelCm: number | null;
  skillTier?: AiSkillTier;
  inputsSource?: AiInputsSource;
}

const SKILL_LABELS: Record<AiSkillTier, string> = {
  high: "Высокая",
  medium: "Средняя",
  low: "Низкая",
  none: "—",
};

/** Classify a predicted level into a risk tier */
function riskTier(
  levelCm: number,
  upperCm: number,
  dangerCm: number,
): { tier: "low" | "moderate" | "elevated" | "high" | "critical"; label: string } {
  if (dangerCm > 0 && upperCm >= dangerCm) return { tier: "critical", label: "Критический" };
  if (dangerCm > 0 && upperCm >= dangerCm * 0.75) return { tier: "high", label: "Высокий" };
  if (dangerCm > 0 && levelCm >= dangerCm * 0.5) return { tier: "elevated", label: "Повышенный" };
  if (levelCm > 0) return { tier: "moderate", label: "Умеренный" };
  return { tier: "low", label: "Низкий" };
}

/** Format date as short weekday + day */
function shortDay(iso: string): { weekday: string; day: string } {
  const d = new Date(iso);
  const weekdays = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  return {
    weekday: weekdays[d.getUTCDay()],
    day: String(d.getUTCDate()),
  };
}

/** Trend description based on forecast trajectory */
function trendText(data: AiForecastPoint[]): string {
  if (data.length < 2) return "";
  const first = data[0].levelCm ?? 0;
  const last = data[data.length - 1].levelCm ?? 0;
  const diff = last - first;
  if (Math.abs(diff) < 1) return "стабильный";
  return diff > 0 ? "рост" : "снижение";
}

export function AiForecastPanel({ data, dangerLevelCm, skillTier, inputsSource }: AiForecastPanelProps) {
  const danger = dangerLevelCm ?? 0;
  const isClimatology = inputsSource === "climatology" || inputsSource === "training-csv";

  const analysis = useMemo(() => {
    if (data.length === 0) return null;

    // Find peak prediction
    let peakIdx = 0;
    let peakLevel = 0;
    for (let i = 0; i < data.length; i++) {
      const lvl = data[i].levelCm ?? 0;
      if (lvl > peakLevel) {
        peakLevel = lvl;
        peakIdx = i;
      }
    }

    const peak = data[peakIdx];
    const peakUpper = peak.predictionUpper ?? peakLevel;
    const peakDate = new Date(peak.measuredAt);
    const peakDateStr = peakDate.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    });

    const peakRisk = riskTier(peakLevel, peakUpper, danger);
    const trend = trendText(data);

    // Overall max risk (considering upper bounds)
    let maxRisk: ReturnType<typeof riskTier> = { tier: "low", label: "Низкий" };
    for (const d of data) {
      const r = riskTier(d.levelCm ?? 0, d.predictionUpper ?? 0, danger);
      const order = ["low", "moderate", "elevated", "high", "critical"];
      if (order.indexOf(r.tier) > order.indexOf(maxRisk.tier)) maxRisk = r;
    }

    // Plain-language sentence
    let sentence = "";
    if (danger > 0 && peakUpper >= danger) {
      sentence = `Возможно превышение опасного уровня (${danger} см) ${peakDateStr}`;
    } else if (danger > 0 && peakUpper >= danger * 0.75) {
      sentence = `Уровень может приблизиться к опасной отметке ${peakDateStr}`;
    } else if (peakLevel > 5) {
      sentence = `Ожидается пик ${Math.round(peakLevel)} см ${peakDateStr}`;
    } else {
      sentence = "Значительного подъёма воды не ожидается";
    }

    // Per-day risk for the strip
    const days = data.map((d) => ({
      ...shortDay(d.measuredAt),
      levelCm: d.levelCm ?? 0,
      upperCm: d.predictionUpper ?? 0,
      risk: riskTier(d.levelCm ?? 0, d.predictionUpper ?? 0, danger),
    }));

    return { peakLevel, peakDateStr, peakRisk, trend, maxRisk, sentence, days };
  }, [data, danger]);

  if (!analysis) return null;

  return (
    <div className="ai-panel">
      {/* Summary card */}
      <div className={`ai-panel-summary ai-panel-summary--${analysis.maxRisk.tier}`}>
        <div className="ai-panel-summary-main">
          <div className="ai-panel-peak">
            <span className="ai-panel-peak-value">{Math.round(analysis.peakLevel)}</span>
            <span className="ai-panel-peak-unit">см</span>
          </div>
          <div className="ai-panel-meta">
            <span className={`ai-panel-badge ai-panel-badge--${analysis.maxRisk.tier}`}>
              {analysis.maxRisk.label}
            </span>
            <span className="ai-panel-trend">
              {analysis.trend === "рост" ? "↑" : analysis.trend === "снижение" ? "↓" : "→"}{" "}
              {analysis.trend}
            </span>
          </div>
        </div>
        <p className="ai-panel-sentence">{analysis.sentence}</p>
        {danger > 0 && (
          <p className="ai-panel-danger-ref">Опасный уровень: {danger} см</p>
        )}
      </div>

      {/* 7-day forecast strip */}
      <div className="ai-panel-strip">
        {analysis.days.map((d, i) => (
          <div key={i} className="ai-strip-day">
            <span className="ai-strip-weekday">{d.weekday}</span>
            <div className={`ai-strip-block ai-strip-block--${d.risk.tier}`}>
              {Math.round(d.levelCm)}
            </div>
            <span className="ai-strip-date">{d.day}</span>
          </div>
        ))}
      </div>

      {/* Skill + source badges */}
      {(skillTier || isClimatology) && (
        <div className="ai-panel-skill">
          {skillTier && skillTier !== "none" && (
            <span className={`ai-panel-skill-badge ai-panel-skill-badge--${skillTier}`}>
              Точность: {SKILL_LABELS[skillTier]}
            </span>
          )}
          {isClimatology && (
            <span className="ai-panel-skill-note">
              Прогноз по сезонной норме — свежих измерений нет
            </span>
          )}
        </div>
      )}

      {/* Disclaimer */}
      <p className="ai-panel-disclaimer">
        Автоматический прогноз Самур AI. Фактические уровни могут отличаться.
      </p>
    </div>
  );
}
