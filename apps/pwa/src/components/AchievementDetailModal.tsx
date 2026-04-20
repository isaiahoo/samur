// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Achievement } from "@samur/shared";

const TIER_LABEL: Record<string, string> = {
  bronze: "Бронза",
  silver: "Серебро",
  gold: "Золото",
};

interface Props {
  ach: Achievement | null;
  earned: boolean;
  progress: { current: number; target: number } | null;
  rarityLabel: string | null;
  onClose: () => void;
}

export function AchievementDetailModal({ ach, earned, progress, rarityLabel, onClose }: Props) {
  useEffect(() => {
    if (!ach) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ach, onClose]);

  if (!ach) return null;

  return createPortal(
    <div className="unlock-overlay" onClick={onClose}>
      <div
        className={`unlock-card unlock-card--${ach.tier} ${earned ? "unlock-card--earned" : "unlock-card--locked"}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="achievement-detail-name"
      >
        <div className="unlock-kicker">
          {earned ? "Награда" : "Не открыта"} — {TIER_LABEL[ach.tier]}
        </div>
        <div className={`unlock-icon unlock-icon--${ach.tier}`}>
          <img src={`/achievements/${ach.key}.webp`} alt="" decoding="async" />
        </div>
        <h2 id="achievement-detail-name" className="unlock-name">{ach.name}</h2>
        <p className="unlock-desc">{ach.description}</p>
        {earned && rarityLabel && (
          <div className="unlock-rarity">{rarityLabel}</div>
        )}
        {!earned && progress && (
          <div className="unlock-progress">
            <div className="achievement-progress-bar">
              <div
                className="achievement-progress-fill"
                style={{ width: `${Math.min(100, (progress.current / progress.target) * 100)}%` }}
              />
            </div>
            <div className="achievement-progress-text">
              {progress.current} / {progress.target}
            </div>
          </div>
        )}
        <button type="button" className="btn btn-primary unlock-btn" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>,
    document.body,
  );
}
