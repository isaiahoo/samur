// SPDX-License-Identifier: AGPL-3.0-only
import { useState, lazy, Suspense } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../../store/auth.js";
import { Spinner } from "../../components/Spinner.js";

const VerificationQueue = lazy(() => import("./VerificationQueue.js").then((m) => ({ default: m.VerificationQueue })));
const HelpManagement = lazy(() => import("./HelpManagement.js").then((m) => ({ default: m.HelpManagement })));
const AlertComposer = lazy(() => import("./AlertComposer.js").then((m) => ({ default: m.AlertComposer })));
const StatsDashboard = lazy(() => import("./StatsDashboard.js").then((m) => ({ default: m.StatsDashboard })));
const RiverLevelsEditor = lazy(() => import("./RiverLevelsEditor.js").then((m) => ({ default: m.RiverLevelsEditor })));
const AiSkillPanel = lazy(() => import("./AiSkillPanel.js").then((m) => ({ default: m.AiSkillPanel })));
const MessageReports = lazy(() => import("./MessageReports.js").then((m) => ({ default: m.MessageReports })));
const UserManagement = lazy(() => import("./UserManagement.js").then((m) => ({ default: m.UserManagement })));

type AdminTab = "verify" | "help" | "reports" | "users" | "alert" | "stats" | "rivers" | "aiSkill";

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("verify");
  const hasRole = useAuthStore((s) => s.hasRole);

  if (!hasRole("coordinator", "admin")) {
    return <Navigate to="/login" replace />;
  }

  const tabs: { key: AdminTab; label: string }[] = [
    { key: "verify", label: "Верификация" },
    { key: "help", label: "Заявки" },
    { key: "reports", label: "Жалобы" },
    { key: "users", label: "Пользователи" },
    { key: "alert", label: "Оповещение" },
    { key: "stats", label: "Статистика" },
    { key: "rivers", label: "Реки" },
    { key: "aiSkill", label: "Точность ИИ" },
  ];

  return (
    <div className="admin-page">
      <div className="admin-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`admin-tab ${tab === t.key ? "admin-tab--active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="admin-content">
        <Suspense fallback={<Spinner />}>
          {tab === "verify" && <VerificationQueue />}
          {tab === "help" && <HelpManagement />}
          {tab === "reports" && <MessageReports />}
          {tab === "users" && <UserManagement />}
          {tab === "alert" && <AlertComposer />}
          {tab === "stats" && <StatsDashboard />}
          {tab === "rivers" && <RiverLevelsEditor />}
          {tab === "aiSkill" && <AiSkillPanel />}
        </Suspense>
      </div>
    </div>
  );
}
