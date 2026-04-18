// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useCallback } from "react";
import type { HelpMessageReport, HelpMessageReportStatus } from "@samur/shared";
import { HELP_MESSAGE_REPORT_REASON_LABELS, formatRelativeTime } from "@samur/shared";
import { getMessageReports, resolveMessageReport, ApiError } from "../../services/api.js";
import { Spinner } from "../../components/Spinner.js";
import { useUIStore, confirmAction } from "../../store/ui.js";

const STATUS_LABELS: Record<HelpMessageReportStatus, string> = {
  open: "Открытые",
  resolved_delete: "Удалено",
  resolved_dismiss: "Отклонено",
};

type FilterTab = HelpMessageReportStatus | "all";

export function MessageReports() {
  const [reports, setReports] = useState<HelpMessageReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<FilterTab>("open");
  const showToast = useUIStore((s) => s.showToast);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getMessageReports(tab);
      setReports((res.data ?? []) as HelpMessageReport[]);
    } catch {
      showToast("Не удалось загрузить жалобы", "error");
    } finally {
      setLoading(false);
    }
  }, [tab, showToast]);

  useEffect(() => { fetch(); }, [fetch]);

  const handleResolve = async (r: HelpMessageReport, action: "delete_message" | "dismiss") => {
    if (action === "delete_message") {
      const ok = await confirmAction({
        title: "Удалить сообщение?",
        message: "Участники увидят «Сообщение удалено» вместо содержимого. Все открытые жалобы на это сообщение закроются.",
        confirmLabel: "Удалить",
        kind: "destructive",
      });
      if (!ok) return;
    }
    try {
      await resolveMessageReport(r.id, action);
      showToast(action === "delete_message" ? "Сообщение удалено" : "Жалоба отклонена", "success");
      // Refetch so resolved reports drop from the "open" tab.
      fetch();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Не удалось применить действие";
      showToast(msg, "error");
    }
  };

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "open", label: "Открытые" },
    { key: "resolved_delete", label: "Удалено" },
    { key: "resolved_dismiss", label: "Отклонено" },
    { key: "all", label: "Все" },
  ];

  return (
    <div className="admin-reports">
      <div className="admin-filter-row">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`admin-subtab ${tab === t.key ? "admin-subtab--active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : reports.length === 0 ? (
        <div className="empty-state"><p>Жалоб нет</p></div>
      ) : (
        <ul className="report-list">
          {reports.map((r) => (
            <li key={r.id} className={`report-card report-card--${r.status}`}>
              <div className="report-card-head">
                <span className="report-card-reason">{HELP_MESSAGE_REPORT_REASON_LABELS[r.reason]}</span>
                <span className="report-card-status">{STATUS_LABELS[r.status]}</span>
                <span className="report-card-time">{formatRelativeTime(r.createdAt)}</span>
              </div>
              <div className="report-card-body">
                <div className="report-card-label">Сообщение:</div>
                {r.message?.deletedAt ? (
                  <div className="report-card-quote report-card-quote--deleted">
                    {r.message.body ? `«${r.message.body}»` : "(пусто)"} · уже удалено
                  </div>
                ) : (
                  <div className="report-card-quote">
                    {r.message?.body ? `«${r.message.body}»` : "(без текста)"}
                  </div>
                )}
                {r.message?.photoUrls && r.message.photoUrls.length > 0 && (
                  <div className="report-card-photos">
                    {r.message.photoUrls.map((u) => (
                      <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="report-card-photo">
                        <img src={u} alt="" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <div className="report-card-meta">
                <div>
                  <span className="report-card-meta-label">Автор сообщения:</span>{" "}
                  {r.message?.author?.name ?? "—"}
                </div>
                <div>
                  <span className="report-card-meta-label">Жалобу отправил:</span>{" "}
                  {r.reporter?.name ?? "—"}
                </div>
                {r.details && (
                  <div>
                    <span className="report-card-meta-label">Комментарий:</span> {r.details}
                  </div>
                )}
                {r.resolvedAt && r.resolver && (
                  <div>
                    <span className="report-card-meta-label">Закрыто:</span>{" "}
                    {r.resolver.name ?? "—"} · {formatRelativeTime(r.resolvedAt)}
                  </div>
                )}
              </div>
              {r.status === "open" && (
                <div className="report-card-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleResolve(r, "dismiss")}
                  >
                    Отклонить
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => handleResolve(r, "delete_message")}
                  >
                    Удалить сообщение
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
