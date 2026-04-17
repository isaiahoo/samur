// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AI Forecast Panel — displays Кунак AI predictions in a clear,
 * actionable format inspired by UK Environment Agency, Google Flood Hub,
 * and Varsom.no patterns.
 *
 * Two rendering modes based on `inputsSource`:
 *
 * 1. Live — the model had recent water-level measurements to anchor its
 *    lags. Show the forecast at full confidence, with risk tiers driven
 *    by predicted values and skill tier driven by the model's hold-out
 *    NSE.
 *
 * 2. Seasonal — measurements are unavailable, so the model's lagged
 *    inputs are day-of-year averages. The output is effectively a
 *    seasonal norm for this date, not a weather-responsive forecast.
 *    Rendering this as a "forecast" is dishonest and dangerous — a
 *    seasonal average can sit above danger in the snowmelt months and
 *    trigger false evacuation-style alerts. In this mode we downgrade
 *    the visual weight, label the values as "сезонная норма", cap the
 *    risk tier, and make it unmistakable that the sensor is silent.
 */

import { useMemo } from "react";
import type { AiForecastPoint, AiSkillTier, AiInputsSource, AiOodWarning, AiSkillRow } from "../../services/api.js";

interface AiForecastPanelProps {
  data: AiForecastPoint[];
  dangerLevelCm: number | null;
  skillTier?: AiSkillTier;
  inputsSource?: AiInputsSource;
  ood?: AiOodWarning[];
  /** Retrospective accuracy from /ai-skill. Shown only when present
   * and the caller has pre-filtered to a meaningful sample. */
  skillRow?: AiSkillRow | null;
}

const SKILL_LABELS: Record<AiSkillTier, string> = {
  high: "Высокая",
  medium: "Средняя",
  low: "Низкая",
  none: "—",
};

const FEATURE_LABELS_RU: Record<string, string> = {
  precipitation_sum: "осадки",
  temperature_2m_max: "макс. темп.",
  temperature_2m_min: "мин. темп.",
  snowfall_sum: "снегопад",
  snow_depth_mean: "толщина снега",
  soil_moisture_0_to_7cm_mean: "влажность почвы",
  et0_fao_evapotranspiration: "испарение",
  rain_sum: "дождь",
  water_level_cm: "уровень воды",
};

const SEASONAL_SOURCES = new Set<AiInputsSource>([
  "climatology",
  "training-csv",
  "unknown",
]);

function isSeasonal(source?: AiInputsSource): boolean {
  return !!source && SEASONAL_SOURCES.has(source);
}

type RiskTier = "low" | "moderate" | "elevated" | "high" | "critical";
const RISK_ORDER: RiskTier[] = ["low", "moderate", "elevated", "high", "critical"];

/** Classify a predicted level into a risk tier */
function riskTier(
  levelCm: number,
  upperCm: number,
  dangerCm: number,
): { tier: RiskTier; label: string } {
  if (dangerCm > 0 && upperCm >= dangerCm) return { tier: "critical", label: "Критический" };
  if (dangerCm > 0 && upperCm >= dangerCm * 0.75) return { tier: "high", label: "Высокий" };
  if (dangerCm > 0 && levelCm >= dangerCm * 0.5) return { tier: "elevated", label: "Повышенный" };
  if (levelCm > 0) return { tier: "moderate", label: "Умеренный" };
  return { tier: "low", label: "Низкий" };
}

/** Cap a risk tier at moderate — used when the data source can't justify
 * a high/critical rating (e.g. seasonal-baseline "forecast"). */
function capAtModerate(risk: { tier: RiskTier; label: string }): { tier: RiskTier; label: string } {
  if (RISK_ORDER.indexOf(risk.tier) <= RISK_ORDER.indexOf("moderate")) return risk;
  return { tier: "moderate", label: "Сезонная норма" };
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

export function AiForecastPanel({ data, dangerLevelCm, skillTier, inputsSource, ood, skillRow }: AiForecastPanelProps) {
  const danger = dangerLevelCm ?? 0;
  const seasonal = isSeasonal(inputsSource);
  const oodList = ood ?? [];

  const analysis = useMemo(() => {
    if (data.length === 0) return null;

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

    const trend = trendText(data);

    // Overall max risk across the horizon (considers upper bound).
    // In seasonal mode, cap at moderate — a seasonal baseline cannot
    // legitimately imply "Critical" risk.
    let maxRisk: ReturnType<typeof riskTier> = { tier: "low", label: "Низкий" };
    for (const d of data) {
      const r = riskTier(d.levelCm ?? 0, d.predictionUpper ?? 0, danger);
      if (RISK_ORDER.indexOf(r.tier) > RISK_ORDER.indexOf(maxRisk.tier)) maxRisk = r;
    }
    if (seasonal) maxRisk = capAtModerate(maxRisk);

    // Plain-language sentence. Seasonal mode gets a completely different
    // framing so users don't read a climatology value as a flood forecast.
    let sentence = "";
    if (seasonal) {
      sentence = `Датчик станции не передаёт свежие измерения. Ниже — обычный уровень воды для этой даты по историческим наблюдениям.`;
    } else if (danger > 0 && peakUpper >= danger) {
      sentence = `Возможно превышение опасного уровня (${danger} см) ${peakDateStr}`;
    } else if (danger > 0 && peakUpper >= danger * 0.75) {
      sentence = `Уровень может приблизиться к опасной отметке ${peakDateStr}`;
    } else if (peakLevel > 5) {
      sentence = `Ожидается пик ${Math.round(peakLevel)} см ${peakDateStr}`;
    } else {
      sentence = "Значительного подъёма воды не ожидается";
    }

    // Per-day strip. In seasonal mode, force every day to "moderate" so
    // the strip doesn't show a red "critical" block on what's actually
    // a seasonal norm.
    const days = data.map((d) => {
      const r = riskTier(d.levelCm ?? 0, d.predictionUpper ?? 0, danger);
      return {
        ...shortDay(d.measuredAt),
        levelCm: d.levelCm ?? 0,
        upperCm: d.predictionUpper ?? 0,
        risk: seasonal ? capAtModerate(r) : r,
      };
    });

    return { peakLevel, peakDateStr, trend, maxRisk, sentence, days };
  }, [data, danger, seasonal]);

  if (!analysis) return null;

  const panelModifier = seasonal ? "ai-panel--seasonal" : "";
  const summaryModifier = seasonal
    ? "ai-panel-summary--seasonal"
    : `ai-panel-summary--${analysis.maxRisk.tier}`;

  return (
    <div className={`ai-panel ${panelModifier}`}>
      {/* Seasonal-mode header banner — must be visually unmistakable.
          Placed above the summary card so users see the caveat before
          the numbers. */}
      {seasonal && (
        <div className="ai-panel-seasonal-banner" role="alert">
          <span className="ai-panel-seasonal-banner-icon">⚠️</span>
          <div className="ai-panel-seasonal-banner-body">
            <strong>Сезонная оценка, не прогноз</strong>
            <span>
              Датчик станции молчит — показана средняя норма за годы наблюдений. Не используйте для решений об эвакуации.
            </span>
          </div>
        </div>
      )}

      {/* Summary card */}
      <div className={`ai-panel-summary ${summaryModifier}`}>
        <div className="ai-panel-summary-main">
          <div className="ai-panel-peak">
            <span className="ai-panel-peak-value">{Math.round(analysis.peakLevel)}</span>
            <span className="ai-panel-peak-unit">см</span>
          </div>
          <div className="ai-panel-meta">
            <span className={`ai-panel-badge ai-panel-badge--${analysis.maxRisk.tier}`}>
              {analysis.maxRisk.label}
            </span>
            {!seasonal && (
              <span className="ai-panel-trend">
                {analysis.trend === "рост" ? "↑" : analysis.trend === "снижение" ? "↓" : "→"}{" "}
                {analysis.trend}
              </span>
            )}
          </div>
        </div>
        <p className="ai-panel-sentence">{analysis.sentence}</p>
        {danger > 0 && !seasonal && (
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
      {(skillTier || seasonal) && (
        <div className="ai-panel-skill">
          {!seasonal && skillTier && skillTier !== "none" && (
            <span className={`ai-panel-skill-badge ai-panel-skill-badge--${skillTier}`}>
              Точность: {SKILL_LABELS[skillTier]}
            </span>
          )}
          {!seasonal && skillRow && skillRow.n >= 10 && (
            <span className="ai-panel-skill-stats" title={`NSE: ${skillRow.nse ?? "—"}, сдвиг: ${skillRow.biasCm >= 0 ? "+" : ""}${skillRow.biasCm} см`}>
              За 30 дней: ±{Math.round(skillRow.rmseCm)}&nbsp;см
              <span className="ai-panel-skill-stats-sub">
                {" · "}t+{skillRow.horizonDays} · {skillRow.n} сверок
              </span>
            </span>
          )}
          {seasonal && (
            <span className="ai-panel-skill-note">
              Прогноз ИИ возобновится, когда восстановится связь с датчиком.
            </span>
          )}
        </div>
      )}

      {/* Out-of-distribution input warning (non-seasonal only — OOD on
          seasonal inputs is noise) */}
      {!seasonal && oodList.length > 0 && (
        <div className="ai-panel-ood" role="note">
          <strong>Необычные условия:</strong>{" "}
          {oodList.map((v, i) => (
            <span key={v.feature}>
              {i > 0 && ", "}
              {FEATURE_LABELS_RU[v.feature] ?? v.feature}
              {v.ratio && v.ratio > 0 ? ` (×${v.ratio.toFixed(1)} от макс.)` : ""}
            </span>
          ))}
          . Прогноз может недооценить пик.
        </div>
      )}

      {/* Disclaimer */}
      <p className="ai-panel-disclaimer">
        {seasonal
          ? "Оценка на основе исторических наблюдений за эту дату. Возможны отклонения от фактического уровня."
          : "Автоматический прогноз Кунак AI. Фактические уровни могут отличаться."}
      </p>
    </div>
  );
}
