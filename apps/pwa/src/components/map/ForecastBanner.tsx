// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Persistent "you're looking at the future" banner — appears at the top of
 * the map canvas when a forecast day beyond today is selected. Gives the
 * user an unambiguous signal that the map isn't live, plus a single tap
 * to return to Сейчас.
 */

interface ForecastBannerProps {
  dateStr: string; // YYYY-MM-DD
  offsetDays: number; // positive integer
  onReturnToNow: () => void;
}

function formatDateRu(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const months = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

export function ForecastBanner({ dateStr, offsetDays, onReturnToNow }: ForecastBannerProps) {
  return (
    <div className="forecast-banner" role="status">
      <span className="forecast-banner-icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </span>
      <span className="forecast-banner-text">
        Прогноз на <strong>{formatDateRu(dateStr)}</strong>
        <span className="forecast-banner-sub"> · через {offsetDays} {offsetDays === 1 ? "день" : offsetDays < 5 ? "дня" : "дней"}</span>
      </span>
      <button
        type="button"
        className="forecast-banner-return"
        onClick={onReturnToNow}
      >
        Вернуться
      </button>
    </div>
  );
}
