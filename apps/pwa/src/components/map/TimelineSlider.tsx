// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Windy-style forecast timeline scrubber.
 *
 * Horizontal slider at bottom of map scrubs through 7-day forecast.
 * Shows day labels as tick marks with play/pause auto-advance.
 */

import { useState, useEffect, useCallback, useRef } from "react";

interface TimelineSliderProps {
  /** Available date strings (YYYY-MM-DD), sorted ascending */
  dates: string[];
  /** Currently selected date index */
  selectedIndex: number;
  /** Called when user changes the selected date */
  onIndexChange: (index: number) => void;
}

const DAY_NAMES_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

function formatTickLabel(dateStr: string, isToday: boolean): string {
  if (isToday) return "Сейчас";
  const d = new Date(dateStr + "T00:00:00");
  return DAY_NAMES_SHORT[d.getDay()];
}

function formatBannerDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}`;
}

export function TimelineSlider({ dates, selectedIndex, onIndexChange }: TimelineSliderProps) {
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayIndex = dates.indexOf(todayStr);
  const isViewingFuture = selectedIndex > todayIndex && todayIndex >= 0;

  // Auto-advance playback
  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        onIndexChange(selectedIndex >= dates.length - 1 ? 0 : selectedIndex + 1);
      }, 1200);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, selectedIndex, dates.length, onIndexChange]);

  const togglePlay = useCallback(() => {
    setPlaying((p) => !p);
  }, []);

  if (dates.length < 2) return null;

  return (
    <div className="timeline-slider">
      {/* Forecast banner when viewing future */}
      {isViewingFuture && (
        <div className="timeline-banner">
          Прогноз на {formatBannerDate(dates[selectedIndex])}
        </div>
      )}

      <div className="timeline-controls">
        {/* Play/pause button */}
        <button
          className="timeline-play-btn"
          onClick={togglePlay}
          aria-label={playing ? "Пауза" : "Воспроизведение"}
        >
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="3" y="2" width="4" height="12" rx="1" />
              <rect x="9" y="2" width="4" height="12" rx="1" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 2l10 6-10 6V2z" />
            </svg>
          )}
        </button>

        {/* Slider track */}
        <div className="timeline-track-wrapper">
          <input
            type="range"
            className="timeline-range"
            min={0}
            max={dates.length - 1}
            value={selectedIndex}
            onChange={(e) => {
              setPlaying(false);
              onIndexChange(Number(e.target.value));
            }}
          />

          {/* Tick labels */}
          <div className="timeline-ticks">
            {dates.map((d, i) => {
              const isToday = d === todayStr;
              return (
                <span
                  key={d}
                  className={`timeline-tick${isToday ? " timeline-tick--today" : ""}${i === selectedIndex ? " timeline-tick--active" : ""}`}
                  style={{ left: `${(i / (dates.length - 1)) * 100}%` }}
                >
                  {formatTickLabel(d, isToday)}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
