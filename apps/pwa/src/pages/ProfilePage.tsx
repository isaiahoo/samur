// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import type { UserActivitySnapshot } from "@samur/shared";
import { getUserStats } from "../services/api.js";
import { useAuthStore } from "../store/auth.js";
import { Spinner } from "../components/Spinner.js";
import {
  ProfileIdentity,
  ProfileStats,
  ProfileAchievements,
  type ProfileData,
} from "../components/ProfileBlocks.js";

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
