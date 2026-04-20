// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import {
  ACHIEVEMENTS,
  computeAchievementProgress,
  type Achievement,
  type UserActivitySnapshot,
} from "@samur/shared";
import { updateMyPreferences, ApiError } from "../services/api.js";
import { useUIStore } from "../store/ui.js";
import { AchievementDetailModal } from "./AchievementDetailModal.js";

export interface ProfileData {
  user: { id: string; name: string | null; role: string; hideAchievements?: boolean };
  helpsCompleted: number;
  helpsActive: number;
  requestsResolved: number;
  requestsActive: number;
  requestsCreated: number;
  joinedAt: string;
  helpsByCategory: Record<string, number>;
  avgResponseToOnWayMinutes: number | null;
  installedPwa?: boolean;
  confirmedHelps?: number;
  confirmedHelpsByCategory?: Record<string, number>;
  distinctConfirmers?: number;
  thankYouQuotes?: Array<{
    id: string;
    note: string;
    createdAt: string;
    category: string;
    authorName: string | null;
  }>;
  achievements: string[];
  achievementRarity?: Record<string, number>;
}

const MONTHS_RU = [
  "января","февраля","марта","апреля","мая","июня",
  "июля","августа","сентября","октября","ноября","декабря",
];
export function formatJoined(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`;
}

const TIER_LABEL: Record<string, string> = {
  bronze: "Бронза",
  silver: "Серебро",
  gold: "Золото",
};

const ELEVATED_ROLE_LABEL: Record<string, string> = {
  coordinator: "Координатор",
  admin: "Администратор",
};

export function ProfileIdentity({ data }: { data: ProfileData }) {
  const initial = (data.user.name ?? "?").trim().charAt(0).toUpperCase() || "?";
  const hue = data.user.name
    ? [...data.user.name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
    : 220;
  const elevated = ELEVATED_ROLE_LABEL[data.user.role];

  return (
    <div className="profile-identity">
      <div
        className="profile-avatar"
        style={{ background: `hsl(${hue} 60% 45%)` }}
      >
        {initial}
      </div>
      <div className="profile-identity-body">
        <div className="profile-name">{data.user.name ?? "Пользователь"}</div>
        <div className="profile-meta">
          {elevated && <span className="profile-role-badge">{elevated}</span>}
          <span className="profile-joined">в сообществе с {formatJoined(data.joinedAt)}</span>
        </div>
      </div>
    </div>
  );
}

export function ProfileStats({ data }: { data: ProfileData }) {
  const confirmed = data.confirmedHelps ?? 0;
  const selfReported = data.helpsCompleted;
  const pending = Math.max(0, selfReported - confirmed);
  return (
    <div className="profile-stats-grid">
      <div className="profile-stat-tile">
        <div className="profile-stat-number">{confirmed}</div>
        <div className="profile-stat-label">подтверждённых</div>
        {pending > 0 && (
          <div className="profile-stat-sublabel">ещё {pending} заявлено</div>
        )}
      </div>
      <div className="profile-stat-tile">
        <div className="profile-stat-number">{data.requestsResolved}</div>
        <div className="profile-stat-label">заявок закрыто</div>
      </div>
      <div className="profile-stat-tile">
        <div className="profile-stat-number">{data.helpsActive + data.requestsActive}</div>
        <div className="profile-stat-label">сейчас активно</div>
      </div>
    </div>
  );
}

const THANKS_MONTH_RU = [
  "янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек",
];
function formatThanksDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${THANKS_MONTH_RU[d.getMonth()]}`;
}

export function ProfileThanks({ quotes }: { quotes: ProfileData["thankYouQuotes"] }) {
  if (!quotes || quotes.length === 0) return null;
  return (
    <div className="profile-thanks">
      <div className="profile-section-header">
        <h2>Что говорят кунаки</h2>
        <span className="profile-section-count">{quotes.length}</span>
      </div>
      <ul className="profile-thanks-list">
        {quotes.map((q) => (
          <li key={q.id} className="profile-thanks-item">
            <div className="profile-thanks-quote">«{q.note}»</div>
            <div className="profile-thanks-meta">
              {q.authorName ?? "Аноним"} · {formatThanksDate(q.createdAt)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProfileAchievements({
  earned, snapshot, rarity, isSelf,
}: {
  earned: Set<string>;
  snapshot: UserActivitySnapshot;
  rarity?: Record<string, number>;
  isSelf?: boolean;
}) {
  const [selected, setSelected] = useState<Achievement | null>(null);
  const earnedCount = earned.size;
  const showRarity = isSelf !== false;

  const selectedEarned = selected ? earned.has(selected.key) : false;
  const selectedProgress = selected && !selectedEarned
    ? computeAchievementProgress(selected, snapshot)
    : null;
  const selectedRarityLabel = selected && showRarity
    ? formatRarity(rarity?.[selected.key], selected.tier)
    : null;

  return (
    <div className="profile-achievements">
      <div className="profile-section-header">
        <h2>Награды</h2>
        <span className="profile-section-count">
          {earnedCount} из {ACHIEVEMENTS.length}
        </span>
      </div>

      {earnedCount === 0 && (
        <p className="profile-achievements-empty">
          Помогите соседям или попросите помощь сами — награды откроются
          автоматически.
        </p>
      )}

      <div className="profile-achievements-grid">
        {ACHIEVEMENTS.map((ach) => (
          <AchievementCard
            key={ach.key}
            ach={ach}
            earned={earned.has(ach.key)}
            snapshot={snapshot}
            rarityCount={rarity?.[ach.key]}
            showRarity={showRarity}
            onOpen={() => setSelected(ach)}
          />
        ))}
      </div>

      <AchievementDetailModal
        ach={selected}
        earned={selectedEarned}
        progress={selectedProgress}
        rarityLabel={selectedRarityLabel}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function formatRarity(count: number | undefined, tier: string): string | null {
  if (count == null) return null;
  if (count === 0) return "ещё никто не получил — будьте первыми";
  if (tier === "gold" && count < 10) return `редкая · получили ${count}`;
  if (count === 1) return "получил 1 человек";
  if (count < 5) return `получили ${count} человека`;
  return `получили ${count} человек`;
}

function AchievementCard({
  ach, earned, snapshot, rarityCount, showRarity, onOpen,
}: {
  ach: Achievement;
  earned: boolean;
  snapshot: UserActivitySnapshot;
  rarityCount?: number;
  showRarity: boolean;
  onOpen: () => void;
}) {
  const progress = earned ? null : computeAchievementProgress(ach, snapshot);
  const rarityLabel = showRarity ? formatRarity(rarityCount, ach.tier) : null;
  return (
    <button
      type="button"
      className={`achievement-card achievement-card--${ach.tier} ${earned ? "achievement-card--earned" : "achievement-card--locked"}`}
      title={ach.description}
      onClick={onOpen}
      aria-label={`${ach.name} — ${earned ? "получена" : "не открыта"}`}
    >
      <div className={`achievement-icon achievement-icon--${ach.tier}`}>
        <img
          src={`/achievements/${ach.key}.webp`}
          alt=""
          loading="lazy"
          decoding="async"
        />
      </div>
      <div className="achievement-name">{ach.name}</div>
      <div className="achievement-desc">{ach.description}</div>
      {earned ? (
        <>
          <div className="achievement-tier">{TIER_LABEL[ach.tier]}</div>
          {rarityLabel && <div className="achievement-rarity">{rarityLabel}</div>}
        </>
      ) : progress ? (
        <div className="achievement-progress">
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
      ) : (
        <div className="achievement-progress-text">ещё не открыта</div>
      )}
    </button>
  );
}

export function ProfilePrivacyToggle({
  initial, onChange,
}: { initial: boolean; onChange?: (value: boolean) => void }) {
  const [hide, setHide] = useState(initial);
  const [saving, setSaving] = useState(false);
  const showToast = useUIStore((s) => s.showToast);

  const toggle = async () => {
    const next = !hide;
    setHide(next);
    setSaving(true);
    try {
      await updateMyPreferences({ hideAchievements: next });
      onChange?.(next);
    } catch (e) {
      setHide(!next);
      showToast(e instanceof ApiError ? e.message : "Не удалось сохранить", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <label className="profile-privacy-toggle">
      <input type="checkbox" checked={hide} onChange={toggle} disabled={saving} />
      <span className="profile-privacy-toggle-body">
        <span className="profile-privacy-toggle-title">Скрыть награды от других</span>
        <span className="profile-privacy-toggle-sub">
          Вы сами будете видеть свои награды, остальные — нет.
        </span>
      </span>
    </label>
  );
}
