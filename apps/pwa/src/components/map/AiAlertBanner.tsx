// SPDX-License-Identifier: AGPL-3.0-only
// Compact map-level AI threat chip. Seasonal-source forecasts never fire
// here — a climatology baseline cannot justify a map-wide alert.

interface AiAlertBannerProps {
  riverName: string;
  stationName: string;
  peakCm: number;
  dangerCm: number;
  peakDate: string;
  skill: "high" | "medium";
  above: boolean;
  onOpen: () => void;
}

export function AiAlertBanner({
  riverName,
  stationName,
  peakCm,
  dangerCm,
  above,
  onOpen,
}: AiAlertBannerProps) {
  const pct = dangerCm > 0 ? Math.round((peakCm / dangerCm) * 100) : 0;
  const severity = above ? "critical" : "elevated";
  const ariaLabel = above
    ? `Превышение опасного уровня: ${riverName} — ${stationName}, ${pct}%`
    : `Приближение к опасному уровню: ${riverName} — ${stationName}, ${pct}%`;

  return (
    <button
      type="button"
      className={`ai-alert-chip ai-alert-chip--${severity}`}
      onClick={onOpen}
      aria-label={ariaLabel}
    >
      <span className="ai-alert-chip-icon" aria-hidden="true">
        {above ? "🚨" : "⚠️"}
      </span>
      <span className="ai-alert-chip-label">
        {stationName} {above ? "выше!" : `${pct}%`}
      </span>
    </button>
  );
}
