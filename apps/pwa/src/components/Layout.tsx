// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useRef, useEffect } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useUIStore } from "../store/ui.js";
import { useAuthStore } from "../store/auth.js";
import { useOnline } from "../hooks/useOnline.js";
import { BottomSheet } from "./BottomSheet.js";
import { Toast } from "./Toast.js";
import { SOSButton } from "./SOSButton.js";
import { MapPage } from "../pages/MapPage.js";
import { HelpPage } from "../pages/HelpPage.js";
import { AlertsPage } from "../pages/AlertsPage.js";
import { NewsPage } from "../pages/NewsPage.js";
import { InfoPage } from "../pages/InfoPage.js";

export function Layout() {
  const unread = useUIStore((s) => s.unreadAlerts);
  const sheetContent = useUIStore((s) => s.sheetContent);
  const closeSheet = useUIStore((s) => s.closeSheet);
  const crisisMode = useUIStore((s) => s.crisisMode);
  const crisisRivers = useUIStore((s) => s.crisisRivers);
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
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const logout = useAuthStore((s) => s.logout);
  const loggedIn = isLoggedIn();

  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  // Close profile menu on outside click
  useEffect(() => {
    if (!profileOpen) return;
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [profileOpen]);

  const handleProfileClick = () => {
    if (loggedIn) {
      setProfileOpen((v) => !v);
    } else {
      navigate("/login");
    }
  };

  const handleLogout = () => {
    logout();
    setProfileOpen(false);
  };

  const initial = user?.name?.charAt(0)?.toUpperCase() || "?";

  return (
    <div className={`app-layout${crisisMode ? " crisis-mode" : ""}`}>
      <a href="#app-main" className="skip-link">Перейти к содержимому</a>
      <header className="app-header">
        <h1 className="app-title">
          <img src="/icons/icon-192.png?v=4" alt="" className="app-logo" width="48" height="48" />
          Самур
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
            </button>

            {profileOpen && loggedIn && (
              <div className="profile-menu">
                <div className="profile-menu-header">
                  <span className="profile-menu-name">{user?.name || "Пользователь"}</span>
                  {user?.phone && <span className="profile-menu-phone">{user.phone}</span>}
                  <span className="profile-menu-role">
                    {user?.role === "volunteer" ? "Волонтёр" : user?.role === "coordinator" ? "Координатор" : user?.role === "admin" ? "Администратор" : "Житель"}
                  </span>
                </div>
                <div className="profile-menu-divider" />
                <button className="profile-menu-item profile-menu-logout" onClick={handleLogout}>
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
          <TabIcon type="info" />
          <span>Инфо</span>
        </NavLink>
      </nav>

      <SOSButton />

      {sheetContent && (
        <BottomSheet onClose={closeSheet}>{sheetContent}</BottomSheet>
      )}

      <Toast />
    </div>
  );
}

function TabIcon({ type }: { type: "map" | "help" | "alerts" | "news" | "info" }) {
  const paths: Record<string, string> = {
    map: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
    help: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z",
    alerts: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
    news: "M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 12h6",
    info: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  };
  return (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d={paths[type]} />
    </svg>
  );
}
