// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Map-level AI alert banner. Surfaces the single most concerning station
 * whose Кунак AI forecast (non-seasonal, skill ≥ medium) is approaching or
 * exceeding its danger level within the next 7 days. Tapping the banner
 * flies the map to that station and opens its detail panel.
 *
 * Suppressed entirely when no station crosses the 75%-of-danger threshold.
 * Seasonal-source forecasts never trigger this banner — a climatology
 * "forecast" cannot legitimately justify a map-wide alert.
 */

interface AiAlertBannerProps {
  riverName: string;
  stationName: string;
  peakCm: number;
  dangerCm: number;
  peakDate: string; // ISO date
  skill: "high" | "medium";
  above: boolean; // peak upper ≥ danger
  onOpen: () => void;
}

function formatDateRu(dateStr: string): string {
  const d = new Date(dateStr);
  const months = [
    "янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек",
  ];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

function hoursUntil(dateStr: string): number {
  return Math.max(1, Math.round((new Date(dateStr).getTime() - Date.now()) / 3_600_000));
}

export function AiAlertBanner({
  riverName,
  stationName,
  peakCm,
  dangerCm,
  peakDate,
  skill,
  above,
  onOpen,
}: AiAlertBannerProps) {
  const pct = dangerCm > 0 ? Math.round((peakCm / dangerCm) * 100) : 0;
  const h = hoursUntil(peakDate);
  const whenText = h < 48 ? `через ${h} ч` : formatDateRu(peakDate);
  const severity = above ? "critical" : "elevated";

  return (
    <button
      type="button"
      className={`ai-alert-banner ai-alert-banner--${severity}`}
      onClick={onOpen}
      aria-label={`Открыть станцию ${stationName}`}
    >
      <span className="ai-alert-banner-icon" aria-hidden="true">
        {above ? "🚨" : "⚠️"}
      </span>
      <span className="ai-alert-banner-body">
        <span className="ai-alert-banner-title">
          Кунак AI: {above ? "возможно превышение опасного уровня" : "приближение к опасному уровню"}
        </span>
        <span className="ai-alert-banner-sub">
          {riverName} — {stationName} · пик {Math.round(peakCm)}&nbsp;см ({pct}%) {whenText}
          <span className="ai-alert-banner-skill"> · точность: {skill === "high" ? "высокая" : "средняя"}</span>
        </span>
      </span>
      <span className="ai-alert-banner-chevron" aria-hidden="true">›</span>
    </button>
  );
}
