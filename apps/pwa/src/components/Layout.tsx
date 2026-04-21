// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useRef, useEffect } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useUIStore, confirmAction } from "../store/ui.js";
import { useAlertsStore, useUnreadCount } from "../store/alerts.js";
import { useAuthStore } from "../store/auth.js";
import { useOnline } from "../hooks/useOnline.js";
import { useSocketEvent } from "../hooks/useSocket.js";
import { getMe, getUserStats, getAlerts, getMyActivity, logoutAll, ApiError, type MyActivity } from "../services/api.js";
import type { User, UserStats } from "@samur/shared";
import { pluralizeRu } from "@samur/shared";
import { BottomSheet } from "./BottomSheet.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import type { Alert as AlertType } from "@samur/shared";
import { Toast } from "./Toast.js";
import { SOSButton } from "./SOSButton.js";
import { ConsentGate } from "./ConsentGate.js";
import { InstallPrompt } from "./InstallPrompt.js";
import { AchievementUnlockModal } from "./AchievementUnlockModal.js";
import { MapPage } from "../pages/MapPage.js";
import { HelpPage } from "../pages/HelpPage.js";
import { AlertsPage } from "../pages/AlertsPage.js";
import { NewsPage } from "../pages/NewsPage.js";
import { InfoPage } from "../pages/InfoPage.js";

export function Layout() {
  const unread = useUnreadCount();
  const setAlerts = useAlertsStore((s) => s.setAlerts);
  const appendAlert = useAlertsStore((s) => s.appendAlert);
  const sheetContent = useUIStore((s) => s.sheetContent);
  const closeSheet = useUIStore((s) => s.closeSheet);
  const crisisMode = useUIStore((s) => s.crisisMode);
  const crisisRivers = useUIStore((s) => s.crisisRivers);
  const showToast = useUIStore((s) => s.showToast);
  const online = useOnline();
  const socketConnected = useUIStore((s) => s.socketConnected);
  const location = useLocation();
  const path = location.pathname;
  const [visited, setVisited] = useState<Set<string>>(() => new Set(["/"]));

  useEffect(() => {
    setVisited((prev) => {
      if (prev.has(path)) return prev;
      const next = new Set(prev);
      next.add(path);
      return next;
    });
  }, [path]);

  const user = useAuthStore((s) => s.user);
  const setAuth = useAuthStore((s) => s.setAuth);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const logout = useAuthStore((s) => s.logout);
  const loggedIn = isLoggedIn();

  // Global alerts bootstrap. Fetches the current active alerts once on
  // app mount (populates the store for badge + AlertsPage) and keeps
  // it in sync with incoming "alert:broadcast" socket events. This used
  // to live inside AlertsPage, which meant the badge silently missed
  // any alert that arrived while the user was on a different tab.
  useEffect(() => {
    getAlerts({ active: true, limit: 50, sort: "sent_at", order: "desc" })
      .then((res) => setAlerts((res.data ?? []) as AlertType[]))
      .catch(() => { /* badge stays at cached value */ });
  }, [setAlerts]);

  useSocketEvent("alert:broadcast", (alert) => {
    appendAlert(alert as AlertType);
  });

  // One-shot JWT sync on app load. If the user's role was changed server-side
  // but their token still carries the old claim, GET /auth/me returns a fresh
  // token alongside the user record — swap it in so role-gated actions (like
  // claiming a help request as a volunteer) stop failing with 403.
  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    getMe().then((res) => {
      if (cancelled) return;
      const nextUser = res.data as User | undefined;
      const nextToken = res.token;
      if (nextToken && nextUser) {
        setAuth(nextToken, nextUser);
      }
    }).catch(() => { /* silent — token stays as-is */ });
    return () => { cancelled = true; };
  }, [loggedIn, setAuth]);

  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const [myStats, setMyStats] = useState<UserStats | null>(null);
  const [earnedAchievements, setEarnedAchievements] = useState<string[]>([]);
  const statsRefreshKey = useUIStore((s) => s.statsRefreshKey);
  const [myActivity, setMyActivity] = useState<MyActivity | null>(null);
  /** Debounce socket-driven activity refetches — a burst of chat messages
   * or a cascade of response-state updates would otherwise hammer the
   * endpoint once per event. */
  const activityRefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshActivity = () => {
    if (!loggedIn) return;
    getMyActivity()
      .then((res) => {
        const next = (res.data ?? null) as MyActivity | null;
        setMyActivity(next);
      })
      .catch(() => { /* silent — counts degrade to last-known */ });
  };
  const refreshActivityDebounced = () => {
    if (activityRefetchTimer.current) clearTimeout(activityRefetchTimer.current);
    activityRefetchTimer.current = setTimeout(refreshActivity, 400);
  };

  // Initial fetch on login + invalidation on commitment/message events.
  // The header dot and menu counts rely on this staying live while the
  // menu is closed — otherwise the user would only learn about unread
  // replies by opening the menu.
  useEffect(() => {
    if (!loggedIn) { setMyActivity(null); return; }
    refreshActivity();
    return () => {
      if (activityRefetchTimer.current) clearTimeout(activityRefetchTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn]);
  // Refetch activity counts when something changed that could move our
  // unread / active-response totals:
  //   - help_response:changed: only "my response state flipped" affects
  //     our activeResponses / ownOpenRequests counts. (This event is
  //     still fanned out globally today; we filter to self here.)
  //   - help_message:notify: server emits this to each participant's
  //     user-room after a message is written. Unlike help_message:created
  //     (room-scoped), notify is safe to broadcast to participants
  //     because it carries no body — just { helpRequestId, authorId }.
  useSocketEvent("help_response:changed", (payload) => {
    if (!user?.id) return;
    if (payload.user?.id !== user.id) return;
    refreshActivityDebounced();
  });
  useSocketEvent("help_message:notify", (payload) => {
    if (!user?.id) return;
    if (payload.authorId === user.id) return;
    refreshActivityDebounced();
  });

  // Fetch stats once on login and whenever the profile menu opens — the
  // latter keeps them fresh after the user completes a help (helpsCompleted
  // goes up) without requiring a reload. Also re-runs when statsRefreshKey
  // is bumped (e.g. PWA install just landed) so the Layout-level unlock
  // modal picks up newly-earned achievements from any screen.
  useEffect(() => {
    if (!loggedIn || !user?.id) {
      setMyStats(null);
      setEarnedAchievements([]);
      return;
    }
    let cancelled = false;
    getUserStats(user.id)
      .then((res) => {
        if (cancelled) return;
        const data = res.data as (UserStats & { achievements?: string[] }) | null;
        setMyStats(data);
        setEarnedAchievements(data?.achievements ?? []);
      })
      .catch(() => { /* silent — stats are a nicety, not critical */ });
    return () => { cancelled = true; };
  }, [loggedIn, user?.id, profileOpen, statsRefreshKey]);

  // Refresh activity counts when the menu opens too — covers the case
  // where a socket event was dropped or the user was offline.
  useEffect(() => {
    if (!profileOpen || !loggedIn) return;
    refreshActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileOpen, loggedIn]);

  // Close profile menu on outside tap. pointerdown is the unified
  // mouse/touch/pen event — mousedown alone was unreliable on iOS
  // Safari (taps in certain scroll regions didn't fire the synthetic
  // mousedown, so the menu stuck open until the next interaction).
  useEffect(() => {
    if (!profileOpen) return;
    const handler = (e: PointerEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [profileOpen]);

  const handleProfileClick = () => {
    if (loggedIn) {
      setProfileOpen((v) => !v);
    } else {
      navigate("/login");
    }
  };

  const openLogoutSheet = () => {
    setProfileOpen(false);
    const doLogout = () => {
      closeSheet();
      logout();
    };
    const doLogoutEverywhere = async () => {
      closeSheet();
      const ok = await confirmAction({
        title: "Выйти со всех устройств?",
        message: "Все активные сессии на этом и других устройствах будут отменены.",
        confirmLabel: "Выйти везде",
        kind: "destructive",
      });
      if (!ok) return;
      try {
        await logoutAll();
      } catch (err) {
        // 401 means the session was already invalidated server-side —
        // the revoke still succeeded, proceed with local logout. Any
        // other error surfaces and we stay logged in so the user can
        // retry.
        if (!(err instanceof ApiError) || err.status !== 401) {
          showToast(err instanceof Error ? err.message : "Ошибка", "error");
          return;
        }
      }
      logout();
    };
    useUIStore.getState().openSheet(
      <LogoutActionSheet
        onLogoutDevice={doLogout}
        onLogoutEverywhere={doLogoutEverywhere}
        onCancel={closeSheet}
      />,
    );
  };

  const initial = user?.name?.charAt(0)?.toUpperCase() || "?";

  return (
    <div className={`app-layout${crisisMode ? " crisis-mode" : ""}`}>
      <a href="#app-main" className="skip-link">Перейти к содержимому</a>
      <InstallPrompt />
      {loggedIn && user?.id && (
        <AchievementUnlockModal userId={user.id} earned={earnedAchievements} />
      )}
      <header className="app-header">
        <h1 className="app-title">
          <img src="/icons/icon-192.png?v=5" alt="" className="app-logo" width="48" height="48" />
          Кунак
        </h1>
        <div className="header-right">
          {online && <span className={`conn-dot ${socketConnected ? "conn-dot--ok" : "conn-dot--off"}`} title={socketConnected ? "Подключено" : "Нет связи с сервером"} />}
          {!online && <span className="offline-badge">Офлайн</span>}

          <div className="profile-wrapper" ref={profileRef}>
            <button
              className={`profile-btn${loggedIn ? " profile-btn--auth" : ""}`}
              onClick={handleProfileClick}
              aria-label={loggedIn ? "Профиль" : "Войти"}
              title={loggedIn ? user?.name ?? "Профиль" : "Войти"}
            >
              {loggedIn ? (
                <span className="profile-initial">{initial}</span>
              ) : (
                <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              )}
              {loggedIn && myActivity && myActivity.unreadMessages > 0 && (
                <span
                  className="profile-btn-dot"
                  aria-label={`${myActivity.unreadMessages} ${pluralizeRu(myActivity.unreadMessages, "непрочитанное сообщение", "непрочитанных сообщения", "непрочитанных сообщений")}`}
                />
              )}
            </button>

            {profileOpen && loggedIn && (
              <div className="profile-menu">
                <div className="profile-menu-header">
                  <span className="profile-menu-name">{user?.name || "Пользователь"}</span>
                  {user?.phone && <span className="profile-menu-phone">{user.phone}</span>}
                  {(user?.role === "coordinator" || user?.role === "admin") && (
                    <span className="profile-menu-role profile-menu-role--elevated">
                      {user.role === "coordinator" ? "Координатор" : "Администратор"}
                    </span>
                  )}
                  {myStats && (
                    <div className="profile-menu-stats">
                      {myStats.helpsCompleted > 0 && (
                        <span className="profile-menu-stat">
                          <strong>{myStats.helpsCompleted}</strong>
                          <small>{pluralizeRu(myStats.helpsCompleted, "помощь", "помощи", "помощей")}</small>
                        </span>
                      )}
                      {myStats.requestsResolved > 0 && (
                        <span className="profile-menu-stat">
                          <strong>{myStats.requestsResolved}</strong>
                          <small>закрыто</small>
                        </span>
                      )}
                      <span className="profile-menu-stat profile-menu-stat--joined">
                        {(() => {
                          const m = ["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"];
                          const d = new Date(myStats.joinedAt);
                          return `с ${m[d.getMonth()]} ${d.getFullYear()}`;
                        })()}
                      </span>
                    </div>
                  )}
                </div>
                {myActivity && (myActivity.activeResponses > 0 || myActivity.ownOpenRequests > 0) && (
                  <>
                    <div className="profile-menu-divider" />
                    {myActivity.activeResponses > 0 && (
                      <button
                        className="profile-menu-item profile-menu-activity"
                        onClick={() => {
                          setProfileOpen(false);
                          navigate("/help#zone-commitments");
                        }}
                      >
                        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                        <span className="profile-menu-activity-label">Мои отклики</span>
                        <span className="profile-menu-activity-count">{myActivity.activeResponses}</span>
                        {myActivity.unreadMessages > 0 && (
                          <span className="profile-menu-activity-unread">
                            {myActivity.unreadMessages} {pluralizeRu(myActivity.unreadMessages, "новое", "новых", "новых")}
                          </span>
                        )}
                        <span className="profile-menu-chevron" aria-hidden="true">›</span>
                      </button>
                    )}
                    {myActivity.ownOpenRequests > 0 && (
                      <button
                        className="profile-menu-item profile-menu-activity"
                        onClick={() => {
                          setProfileOpen(false);
                          navigate("/help#zone-own");
                        }}
                      >
                        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
                          <rect x="4" y="4" width="16" height="16" rx="2" />
                          <path d="M9 10h6M9 14h4" />
                        </svg>
                        <span className="profile-menu-activity-label">Мои заявки</span>
                        <span className="profile-menu-activity-count">{myActivity.ownOpenRequests}</span>
                        <span className="profile-menu-chevron" aria-hidden="true">›</span>
                      </button>
                    )}
                  </>
                )}
                <div className="profile-menu-divider" />
                <button
                  className="profile-menu-item"
                  onClick={() => {
                    setProfileOpen(false);
                    navigate("/info");
                  }}
                >
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Мой профиль
                </button>
                <div className="profile-menu-divider" />
                <button className="profile-menu-item profile-menu-logout" onClick={openLogoutSheet}>
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Выйти
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {crisisMode && (
        <div className="crisis-banner">
          <span className="crisis-chevron" />
          <span className="crisis-banner-text">
            КРИТИЧЕСКАЯ СИТУАЦИЯ — р. {crisisRivers.join(", р. ")}
          </span>
          <span className="crisis-chevron" />
        </div>
      )}

      <main className="app-main" id="app-main">
        {/* All tab pages stay mounted once visited — no re-fetch on tab switch */}
        <div className={path === "/" ? "tab-alive tab-alive--visible" : "tab-alive"}>
          <MapPage />
        </div>
        {visited.has("/help") && (
          <div className={path === "/help" ? "tab-alive tab-alive--visible" : "tab-alive"}>
            <HelpPage />
          </div>
        )}
        {visited.has("/alerts") && (
          <div className={path === "/alerts" ? "tab-alive tab-alive--visible" : "tab-alive"}>
            <AlertsPage />
          </div>
        )}
        {visited.has("/news") && (
          <div className={path === "/news" ? "tab-alive tab-alive--visible" : "tab-alive"}>
            <NewsPage />
          </div>
        )}
        {visited.has("/info") && (
          <div className={path === "/info" ? "tab-alive tab-alive--visible" : "tab-alive"}>
            <InfoPage />
          </div>
        )}
      </main>

      <nav className="app-tabbar">
        <NavLink to="/" end className={({ isActive }) => `tab ${isActive ? "tab--active" : ""}`}>
          <TabIcon type="map" />
          <span>Карта</span>
        </NavLink>
        <NavLink to="/help" className={({ isActive }) => `tab ${isActive ? "tab--active" : ""}`}>
          <TabIcon type="help" />
          <span>Помощь</span>
        </NavLink>
        <NavLink to="/alerts" className={({ isActive }) => `tab ${isActive ? "tab--active" : ""}`}>
          <TabIcon type="alerts" />
          <span>Оповещения</span>
          {unread > 0 && <span className="tab-badge">{unread > 99 ? "99+" : unread}</span>}
        </NavLink>
        <NavLink to="/news" className={({ isActive }) => `tab ${isActive ? "tab--active" : ""}`}>
          <TabIcon type="news" />
          <span>Новости</span>
        </NavLink>
        <NavLink to="/info" className={({ isActive }) => `tab ${isActive ? "tab--active" : ""}`}>
          <TabIcon type="profile" />
          <span>Профиль</span>
        </NavLink>
      </nav>

      <SOSButton />

      {sheetContent && (
        <BottomSheet onClose={closeSheet}>{sheetContent}</BottomSheet>
      )}

      <ConfirmDialog />

      <Toast />

      <ConsentGate />
    </div>
  );
}

function LogoutActionSheet({
  onLogoutDevice, onLogoutEverywhere, onCancel,
}: {
  onLogoutDevice: () => void;
  onLogoutEverywhere: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="logout-sheet">
      <div className="logout-sheet-header">
        <h2>Выйти</h2>
        <p>Выберите, где завершить сессию.</p>
      </div>
      <button type="button" className="logout-sheet-option" onClick={onLogoutDevice}>
        <span className="logout-sheet-option-title">Выйти с этого устройства</span>
        <span className="logout-sheet-option-sub">На других устройствах вы останетесь в аккаунте.</span>
      </button>
      <button type="button" className="logout-sheet-option" onClick={onLogoutEverywhere}>
        <span className="logout-sheet-option-title">Выйти со всех устройств</span>
        <span className="logout-sheet-option-sub">Все активные сессии будут отменены.</span>
      </button>
      <button type="button" className="logout-sheet-cancel" onClick={onCancel}>
        Отмена
      </button>
    </div>
  );
}

function TabIcon({ type }: { type: "map" | "help" | "alerts" | "news" | "profile" }) {
  const paths: Record<string, string> = {
    map: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
    help: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z",
    alerts: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
    news: "M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 12h6",
    profile: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  };
  return (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d={paths[type]} />
    </svg>
  );
}
