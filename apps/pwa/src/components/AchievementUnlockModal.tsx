// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ACHIEVEMENTS, type Achievement } from "@samur/shared";

const STORAGE_KEY = "kunak.seenAchievements.v1";

const TIER_LABEL: Record<string, string> = {
  bronze: "Бронза",
  silver: "Серебро",
  gold: "Золото",
};

/** Read the set of achievement keys this user has already been
 * congratulated for. Scoped by userId so switching accounts doesn't
 * skip unlock celebrations for the new one. */
function readSeen(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${userId}`);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is string => typeof k === "string"));
  } catch {
    return new Set();
  }
}

function writeSeen(userId: string, seen: Set<string>): void {
  try {
    localStorage.setItem(`${STORAGE_KEY}:${userId}`, JSON.stringify([...seen]));
  } catch {
    // quota exhausted or storage disabled — non-fatal
  }
}

interface Props {
  /** The current user's id. Used to scope the "seen" set. */
  userId: string | null;
  /** The full set of earned achievement keys returned by the server. */
  earned: string[];
}

/**
 * When `earned` gains keys we haven't shown a celebration for, surface
 * them one at a time in a portal modal. Intended to be rendered at the
 * page level (InfoPage / ProfilePage) so it's visible above the tab
 * chrome and survives re-renders.
 *
 * The list is deliberately stored client-side — a missed celebration
 * (user installed a fresh device) isn't worth the server round-trips.
 */
export function AchievementUnlockModal({ userId, earned }: Props) {
  const [queue, setQueue] = useState<Achievement[]>([]);
  const [visibleIdx, setVisibleIdx] = useState(0);

  useEffect(() => {
    if (!userId) return;
    const seen = readSeen(userId);
    const firstRun = seen.size === 0;
    const fresh: Achievement[] = [];
    for (const key of earned) {
      if (!seen.has(key)) {
        seen.add(key);
        const ach = ACHIEVEMENTS.find((a) => a.key === key);
        if (ach) fresh.push(ach);
      }
    }
    writeSeen(userId, seen);
    // First visit on a device — don't flood the user with a stack of
    // pop-ups for achievements earned before this code existed. Silently
    // mark them seen. Future unlocks will show the celebration.
    if (firstRun || fresh.length === 0) return;
    setQueue(fresh);
    setVisibleIdx(0);
  }, [userId, earned]);

  if (queue.length === 0 || visibleIdx >= queue.length) return null;
  const ach = queue[visibleIdx];

  const next = () => {
    if (visibleIdx + 1 < queue.length) setVisibleIdx(visibleIdx + 1);
    else { setQueue([]); setVisibleIdx(0); }
  };

  return createPortal(
    <div className="unlock-overlay" onClick={next}>
      <div
        className={`unlock-card unlock-card--${ach.tier}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="unlock-kicker">Новая награда — {TIER_LABEL[ach.tier]}</div>
        <div className="unlock-icon">
          <img src={`/achievements/${ach.key}.webp`} alt="" decoding="async" />
        </div>
        <h2 className="unlock-name">{ach.name}</h2>
        <p className="unlock-desc">{ach.description}</p>
        {queue.length > 1 && (
          <div className="unlock-counter">{visibleIdx + 1} / {queue.length}</div>
        )}
        <button type="button" className="btn btn-primary unlock-btn" onClick={next}>
          {visibleIdx + 1 < queue.length ? "Дальше" : "Закрыть"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
