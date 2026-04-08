// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../../store/auth.js";
import { VerificationQueue } from "./VerificationQueue.js";
import { HelpManagement } from "./HelpManagement.js";
import { AlertComposer } from "./AlertComposer.js";
import { StatsDashboard } from "./StatsDashboard.js";
import { RiverLevelsEditor } from "./RiverLevelsEditor.js";

type AdminTab = "verify" | "help" | "alert" | "stats" | "rivers";

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("verify");
  const hasRole = useAuthStore((s) => s.hasRole);

  if (!hasRole("coordinator", "admin")) {
    return <Navigate to="/login" replace />;
  }

  const tabs: { key: AdminTab; label: string }[] = [
    { key: "verify", label: "Верификация" },
    { key: "help", label: "Заявки" },
    { key: "alert", label: "Оповещение" },
    { key: "stats", label: "Статистика" },
    { key: "rivers", label: "Реки" },
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
        {tab === "verify" && <VerificationQueue />}
        {tab === "help" && <HelpManagement />}
        {tab === "alert" && <AlertComposer />}
        {tab === "stats" && <StatsDashboard />}
        {tab === "rivers" && <RiverLevelsEditor />}
      </div>
    </div>
  );
}
