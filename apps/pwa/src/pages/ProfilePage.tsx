// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import {
  ACHIEVEMENTS,
  computeAchievementProgress,
  type Achievement,
  type UserActivitySnapshot,
} from "@samur/shared";
import { getUserStats } from "../services/api.js";
import { useAuthStore } from "../store/auth.js";
import { Spinner } from "../components/Spinner.js";

interface ProfileData {
  user: { id: string; name: string | null; role: string };
  helpsCompleted: number;
  helpsActive: number;
  requestsResolved: number;
  requestsActive: number;
  requestsCreated: number;
  joinedAt: string;
  helpsByCategory: Record<string, number>;
  avgResponseToOnWayMinutes: number | null;
  installedPwa?: boolean;
  achievements: string[];
}

const MONTHS_RU = [
  "января","февраля","марта","апреля","мая","июня",
  "июля","августа","сентября","октября","ноября","декабря",
];
function formatJoined(iso: string): string {
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

export function ProfilePage() {
  const { id: paramId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)();

  // Route /profile/me redirects to the current user's id so bookmarks
  // resolve to the specific profile, not a floating alias.
  if (paramId === "me") {
    if (!currentUser?.id) return <Navigate to="/login" replace />;
    return <Navigate to={`/profile/${currentUser.id}`} replace />;
  }

  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!paramId || !isLoggedIn) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getUserStats(paramId)
      .then((res) => {
        if (cancelled) return;
        setData(res.data as ProfileData);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Не удалось загрузить профиль");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [paramId, isLoggedIn]);

  const snapshot = useMemo<UserActivitySnapshot | null>(() => {
    if (!data) return null;
    return {
      helpsCompleted: data.helpsCompleted,
      requestsCreated: data.requestsCreated,
      joinedAt: data.joinedAt,
      helpsByCategory: data.helpsByCategory,
      avgResponseToOnWayMinutes: data.avgResponseToOnWayMinutes,
      installedPwa: data.installedPwa ?? false,
    };
  }, [data]);

  const isMe = currentUser?.id === paramId;

  if (!isLoggedIn) return <Navigate to="/login" replace />;

  return (
    <div className="profile-page">
      <div className="profile-header-bar">
        <button className="profile-back" onClick={() => navigate(-1)} aria-label="Назад">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="profile-title">{isMe ? "Мой профиль" : "Профиль"}</h1>
      </div>

      {loading ? (
        <div className="profile-loading"><Spinner /></div>
      ) : error ? (
        <div className="profile-error">{error}</div>
      ) : data ? (
        <>
          <ProfileIdentity data={data} />
          <ProfileStats data={data} />
          <ProfileAchievements earned={new Set(data.achievements)} snapshot={snapshot!} />
        </>
      ) : null}
    </div>
  );
}

// ── Identity card: avatar + name + role badge + joined ──────────────────

function ProfileIdentity({ data }: { data: ProfileData }) {
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

// ── Stats strip: big numeric tiles ──────────────────────────────────────

function ProfileStats({ data }: { data: ProfileData }) {
  return (
    <div className="profile-stats-grid">
      <div className="profile-stat-tile">
        <div className="profile-stat-number">{data.helpsCompleted}</div>
        <div className="profile-stat-label">помощей</div>
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

// ── Achievements: 13-badge grid, earned in colour, locked dimmed ────────

function ProfileAchievements({
  earned, snapshot,
}: { earned: Set<string>; snapshot: UserActivitySnapshot }) {
  const earnedCount = earned.size;
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
          />
        ))}
      </div>
    </div>
  );
}

function AchievementCard({
  ach, earned, snapshot,
}: { ach: Achievement; earned: boolean; snapshot: UserActivitySnapshot }) {
  const progress = earned ? null : computeAchievementProgress(ach, snapshot);
  return (
    <div
      className={`achievement-card achievement-card--${ach.tier} ${earned ? "achievement-card--earned" : "achievement-card--locked"}`}
      title={ach.description}
    >
      <div className="achievement-icon" aria-hidden="true">{ach.icon}</div>
      <div className="achievement-name">{ach.name}</div>
      <div className="achievement-desc">{ach.description}</div>
      {earned ? (
        <div className="achievement-tier">{TIER_LABEL[ach.tier]}</div>
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
    </div>
  );
}
