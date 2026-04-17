// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Forecast day picker — replaces the old bottom-scrubber timeline.
 *
 * Button lives in the top-right map-controls cluster, so it never competes
 * with the bottom nav tabs. Popover offers pill-style day selection
 * (Сейчас / +1д / +2д / +3д / +5д / +7д) plus an optional animate button.
 * No always-on canvas footprint when the user isn't looking at forecasts.
 */
import { useState, useEffect, useRef, useCallback } from "react";

interface ForecastPickerProps {
  /** YYYY-MM-DD strings, sorted ascending */
  dates: string[];
  selectedIndex: number;
  onIndexChange: (index: number) => void;
}

// Horizon offsets we surface as pills. +2 is there because of how flood
// coordinators actually think ("day after tomorrow"); +4 and +6 add visual
// clutter for negligible info gain, so we collapse the middle to +3 and
// the end to +5 / +7.
const HORIZON_OFFSETS = [0, 1, 2, 3, 5, 7];

function pillLabel(offset: number): string {
  if (offset === 0) return "Сейчас";
  return `+${offset} д`;
}

function formatDateRu(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const months = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

export function ForecastPicker({ dates, selectedIndex, onIndexChange }: ForecastPickerProps) {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayIndex = dates.indexOf(todayStr);
  const selectedDate = dates[selectedIndex] ?? todayStr;
  const selectedOffsetDays =
    todayIndex < 0 ? 0 : Math.round(
      (new Date(selectedDate).getTime() - new Date(todayStr).getTime()) / 86_400_000,
    );
  const isFuture = selectedOffsetDays > 0;

  // Close popover on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Animation: 8-second sweep through all 7 days, stops on Сейчас.
  useEffect(() => {
    if (!playing) return;
    intervalRef.current = setInterval(() => {
      onIndexChange(selectedIndex >= dates.length - 1 ? 0 : selectedIndex + 1);
    }, 1200);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, selectedIndex, dates.length, onIndexChange]);

  // Auto-stop animation when we've looped back to Сейчас.
  useEffect(() => {
    if (playing && selectedIndex === todayIndex) setPlaying(false);
  }, [playing, selectedIndex, todayIndex]);

  const handlePillClick = useCallback((offset: number) => {
    setPlaying(false);
    const targetDate = new Date(todayStr);
    targetDate.setDate(targetDate.getDate() + offset);
    const targetStr = targetDate.toISOString().slice(0, 10);
    // Exact match, else nearest — the dates array may not have every day.
    let bestIdx = dates.findIndex((d) => d === targetStr);
    if (bestIdx < 0) {
      // Snap to closest available date.
      let bestDiff = Infinity;
      dates.forEach((d, i) => {
        const diff = Math.abs(new Date(d).getTime() - targetDate.getTime());
        if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
      });
    }
    if (bestIdx >= 0) onIndexChange(bestIdx);
    setOpen(false);
  }, [dates, todayStr, onIndexChange]);

  if (dates.length < 2) return null;

  return (
    <div className="forecast-picker" ref={rootRef}>
      <button
        type="button"
        className={`forecast-picker-btn${isFuture ? " forecast-picker-btn--future" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Прогноз на будущее"
        title="Прогноз на будущее"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        {isFuture && (
          <span className="forecast-picker-badge">+{selectedOffsetDays} д</span>
        )}
      </button>

      {open && (
        <div className="forecast-picker-panel" role="dialog" aria-label="Выбор дня прогноза">
          <div className="forecast-picker-header">
            <span className="forecast-picker-title">Прогноз</span>
            <span className="forecast-picker-date">{formatDateRu(selectedDate)}</span>
          </div>
          <div className="forecast-picker-pills">
            {HORIZON_OFFSETS.map((offset) => {
              const active = offset === selectedOffsetDays;
              return (
                <button
                  key={offset}
                  type="button"
                  className={`forecast-pill${active ? " forecast-pill--active" : ""}`}
                  onClick={() => handlePillClick(offset)}
                >
                  {pillLabel(offset)}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="forecast-picker-animate"
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? (
              <>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <rect x="3" y="2" width="4" height="12" rx="1" />
                  <rect x="9" y="2" width="4" height="12" rx="1" />
                </svg>
                Остановить
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M4 2l10 6-10 6V2z" />
                </svg>
                Воспроизвести 7 дней
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
