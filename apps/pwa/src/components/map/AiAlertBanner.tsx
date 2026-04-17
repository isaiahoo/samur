// SPDX-License-Identifier: AGPL-3.0-only
// Glanceable AI threat chip — a compact mini-gauge pill. The fill bar
// visualises % of danger so the severity reads without a tap; the chip
// is still tappable for users who want the full detail sheet.
//
// Seasonal-source forecasts never reach here — a climatology baseline
// cannot legitimately justify a map-wide alert.

interface AiAlertBannerProps {
  riverName: string;
  stationName: string;
  peakCm: number;
  dangerCm: number;
  peakDate: string;
  skill: "high" | "medium";
  above: boolean;
  rising: boolean;
  onOpen: () => void;
}

export function AiAlertBanner({
  riverName,
  stationName,
  peakCm,
  dangerCm,
  above,
  rising,
  onOpen,
}: AiAlertBannerProps) {
  const rawPct = dangerCm > 0 ? peakCm / dangerCm : 0;
  const pct = Math.round(rawPct * 100);
  // Clamp the fill bar at 100% so above-danger forecasts don't overflow
  // the pill, but keep the numeric percentage honest.
  const fill = Math.min(Math.max(rawPct, 0), 1);
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
      <span className="ai-alert-chip-name">{stationName}</span>
      <span className="ai-alert-chip-pct">{pct}%</span>
      <span
        className="ai-alert-chip-gauge"
        aria-hidden="true"
      >
        <span
          className="ai-alert-chip-gauge-fill"
          style={{ width: `${fill * 100}%` }}
        />
      </span>
      {rising && (
        <span className="ai-alert-chip-trend" aria-label="Тренд: рост">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 7 L5 3 L8 7" />
          </svg>
        </span>
      )}
    </button>
  );
}
