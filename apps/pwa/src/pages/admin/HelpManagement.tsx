// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useCallback } from "react";
import type { HelpRequest, HelpRequestStatus } from "@samur/shared";
import {
  HELP_CATEGORY_LABELS,
  URGENCY_LABELS,
  HELP_REQUEST_STATUS_LABELS,
  HELP_REQUEST_STATUSES,
} from "@samur/shared";
import { formatRelativeTime } from "@samur/shared";
import { getHelpRequests, updateHelpRequest } from "../../services/api.js";
import { UrgencyBadge } from "../../components/UrgencyBadge.js";
import { Spinner } from "../../components/Spinner.js";
import { useUIStore } from "../../store/ui.js";

export function HelpManagement() {
  const [items, setItems] = useState<HelpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const showToast = useUIStore((s) => s.showToast);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { limit: 50, sort: "created_at", order: "desc" };
      if (statusFilter) params.status = statusFilter;
      const res = await getHelpRequests(params);
      setItems((res.data ?? []) as HelpRequest[]);
    } catch {
      showToast("Не удалось загрузить заявки", "error");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, showToast]);

  useEffect(() => { fetch(); }, [fetch]);

  const handleStatusChange = async (id: string, status: HelpRequestStatus) => {
    try {
      await updateHelpRequest(id, { status });
      setItems((prev) => prev.map((h) => (h.id === id ? { ...h, status } : h)));
      showToast("Статус обновлён", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Ошибка", "error");
    }
  };

  return (
    <div>
      <div className="admin-filter-row">
        <select
          className="form-input form-input--sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Все статусы</option>
          {HELP_REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>{HELP_REQUEST_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {loading ? <Spinner /> : items.length === 0 ? (
        <div className="empty-state"><p>Нет заявок</p></div>
      ) : (
        <div className="help-mgmt-list">
          {items.map((hr) => (
            <div key={hr.id} className="help-mgmt-card">
              <div className="help-mgmt-header">
                <span>{HELP_CATEGORY_LABELS[hr.category]}</span>
                <UrgencyBadge value={hr.urgency} kind="urgency" />
                <span className="help-mgmt-type">{hr.type === "offer" ? "Предложение" : "Запрос"}</span>
              </div>
              {hr.description && <p>{hr.description}</p>}
              <p className="text-muted">
                {hr.contactName && <>{hr.contactName} · </>}
                {hr.contactPhone && <>{hr.contactPhone} · </>}
                {formatRelativeTime(hr.createdAt)}
              </p>
              <div className="help-mgmt-actions">
                <select
                  className="form-input form-input--sm"
                  value={hr.status}
                  onChange={(e) => handleStatusChange(hr.id, e.target.value as HelpRequestStatus)}
                >
                  {HELP_REQUEST_STATUSES.map((s) => (
                    <option key={s} value={s}>{HELP_REQUEST_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
