// SPDX-License-Identifier: AGPL-3.0-only
// Floating alert label — reads as a map annotation, not a button.
// Seasonal-source forecasts never reach here (filtered upstream).

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
  const pct = dangerCm > 0 ? Math.round((peakCm / dangerCm) * 100) : 0;
  const severity = above ? "critical" : "elevated";
  const ariaLabel = above
    ? `Превышение опасного уровня: ${riverName} — ${stationName}, ${pct}%`
    : `Приближение к опасному уровню: ${riverName} — ${stationName}, ${pct}%`;

  return (
    <button
      type="button"
      className={`ai-alert-label ai-alert-label--${severity}`}
      onClick={onOpen}
      aria-label={ariaLabel}
    >
      <span className="ai-alert-label-name">{stationName}</span>
      <span className="ai-alert-label-sep" aria-hidden="true">·</span>
      <span className="ai-alert-label-pct">{pct}%</span>
      {rising && (
        <svg
          className="ai-alert-label-arrow"
          width="12" height="12" viewBox="0 0 12 12"
          fill="none" stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 7 L6 3 L9 7" />
          <path d="M6 3 L6 10" />
        </svg>
      )}
    </button>
  );
}
