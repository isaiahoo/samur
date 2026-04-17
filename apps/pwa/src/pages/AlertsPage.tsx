// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useCallback } from "react";
import type { Alert } from "@samur/shared";
import { ALERT_URGENCY_LABELS, ALERT_URGENCY_COLORS, ALERT_SOURCE_LABELS, ALERT_SOURCE_ICONS } from "@samur/shared";
import { formatRelativeTime } from "@samur/shared";
import { getAlerts, getAlertsSituation } from "../services/api.js";
import type { AlertsSituation } from "../services/api.js";
import { Spinner } from "../components/Spinner.js";
import { SituationSummary } from "../components/alerts/SituationSummary.js";
import { AlertActions } from "../components/alerts/AlertActions.js";
import { useSocketEvent } from "../hooks/useSocket.js";
import { useUIStore } from "../store/ui.js";

export function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [situation, setSituation] = useState<AlertsSituation | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissedCritical, setDismissedCritical] = useState<Set<string>>(new Set());

  const resetUnread = useUIStore((s) => s.resetUnread);
  const incrementUnread = useUIStore((s) => s.incrementUnread);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [alertsRes, situationRes] = await Promise.all([
        getAlerts({ active: true, limit: 50, sort: "sent_at", order: "desc" }),
        getAlertsSituation().catch(() => null),
      ]);
      setAlerts((alertsRes.data ?? []) as Alert[]);
      if (situationRes?.data) setSituation(situationRes.data);
    } catch {
      // silent — overlay failures don't block the page
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    resetUnread();
  }, [fetchAll, resetUnread]);

  useSocketEvent("alert:broadcast", (alert) => {
    setAlerts((prev) => [alert, ...prev]);
    incrementUnread();

    if (alert.urgency === "critical" && "Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification("Кунак — КРИТИЧЕСКОЕ", {
          body: alert.title,
          icon: "/icons/icon-192.png",
          tag: alert.id,
        });
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then((perm) => {
          if (perm === "granted") {
            new Notification("Кунак — КРИТИЧЕСКОЕ", {
              body: alert.title,
              icon: "/icons/icon-192.png",
              tag: alert.id,
            });
          }
        });
      }
    }
  });

  const criticalAlerts = alerts.filter(
    (a) => a.urgency === "critical" && !dismissedCritical.has(a.id),
  );
  const otherAlerts = alerts.filter(
    (a) => a.urgency !== "critical" || dismissedCritical.has(a.id),
  );

  if (loading) return <Spinner />;

  return (
    <div className="alerts-page">
      {situation && <SituationSummary data={situation} />}

      {criticalAlerts.map((a) => (
        <div key={a.id} className="alert-banner alert-banner--critical">
          <div className="alert-banner-content">
            <span className="alert-urgency-icon" aria-hidden="true">
              {ALERT_SOURCE_ICONS[a.source] ?? "⚠️"}
            </span>
            <div className="alert-banner-body">
              <span className="alert-banner-source">{ALERT_SOURCE_LABELS[a.source] ?? "Оповещение"}</span>
              <strong>{a.title}</strong>
              <p>{a.body}</p>
              <small>{formatRelativeTime(a.sentAt)}</small>
              <AlertActions alert={a} />
            </div>
          </div>
          <button
            className="alert-dismiss"
            onClick={() => setDismissedCritical((prev) => new Set(prev).add(a.id))}
            aria-label="Скрыть"
          >
            ✕
          </button>
        </div>
      ))}

      {alerts.length === 0 ? (
        <div className="alerts-empty-note">Новых оповещений нет — следите за ситуацией выше.</div>
      ) : (
        <div className="alerts-list">
          {otherAlerts.map((a) => (
            <AlertCard key={a.id} alert={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertCard({ alert }: { alert: Alert }) {
  const colorClass =
    alert.urgency === "critical"
      ? "alert-card--critical"
      : alert.urgency === "warning"
        ? "alert-card--warning"
        : "alert-card--info";

  const sourceIcon = ALERT_SOURCE_ICONS[alert.source] ?? "📢";
  const sourceLabel = ALERT_SOURCE_LABELS[alert.source] ?? "Оповещение";

  return (
    <div className={`alert-card ${colorClass}`}>
      <div className="alert-card-header">
        <span className={`alert-source alert-source--${alert.source}`} title={sourceLabel}>
          <span className="alert-source-icon" aria-hidden="true">{sourceIcon}</span>
          <span className="alert-source-label">{sourceLabel}</span>
        </span>
        <span
          className="alert-urgency-badge"
          style={{ backgroundColor: ALERT_URGENCY_COLORS[alert.urgency] }}
        >
          {ALERT_URGENCY_LABELS[alert.urgency]}
        </span>
        <span className="alert-time">{formatRelativeTime(alert.sentAt)}</span>
      </div>
      <h3 className="alert-title">{alert.title}</h3>
      <p className="alert-body">{alert.body}</p>
      <AlertActions alert={alert} />
    </div>
  );
}
