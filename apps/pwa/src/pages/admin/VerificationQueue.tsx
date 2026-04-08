// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useCallback } from "react";
import type { Incident } from "@samur/shared";
import { INCIDENT_TYPE_LABELS, SEVERITY_LABELS } from "@samur/shared";
import { formatRelativeTime } from "@samur/shared";
import { getIncidents, updateIncident } from "../../services/api.js";
import { UrgencyBadge } from "../../components/UrgencyBadge.js";
import { Spinner } from "../../components/Spinner.js";
import { useUIStore } from "../../store/ui.js";

export function VerificationQueue() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const showToast = useUIStore((s) => s.showToast);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getIncidents({ status: "unverified", limit: 50, sort: "created_at", order: "desc" });
      setIncidents((res.data ?? []) as Incident[]);
    } catch {
      showToast("Не удалось загрузить инциденты", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetch(); }, [fetch]);

  const handleAction = async (id: string, status: "verified" | "false_report") => {
    try {
      await updateIncident(id, { status });
      setIncidents((prev) => prev.filter((i) => i.id !== id));
      showToast(status === "verified" ? "Подтверждено" : "Отклонено", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Ошибка", "error");
    }
  };

  if (loading) return <Spinner />;

  if (incidents.length === 0) {
    return <div className="empty-state"><p>Нет инцидентов для верификации</p></div>;
  }

  return (
    <div className="verification-list">
      {incidents.map((inc) => (
        <div key={inc.id} className="verification-card">
          <div className="verification-header">
            <span className="verification-type">{INCIDENT_TYPE_LABELS[inc.type]}</span>
            <UrgencyBadge value={inc.severity} kind="severity" />
          </div>
          {inc.description && <p>{inc.description}</p>}
          {inc.address && <p className="text-muted">{inc.address}</p>}
          <p className="text-muted">
            {inc.lat.toFixed(4)}, {inc.lng.toFixed(4)} · {formatRelativeTime(inc.createdAt)}
          </p>
          <div className="verification-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => handleAction(inc.id, "verified")}
            >
              Подтвердить
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => handleAction(inc.id, "false_report")}
            >
              Ложный отчёт
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
