// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useCallback, useRef } from "react";
import type { Alert } from "@samur/shared";
import {
  ALERT_URGENCY_LABELS,
  ALERT_URGENCY_COLORS,
  ALERT_SOURCE_LABELS,
  ALERT_SOURCE_ICONS,
  formatRelativeTime,
} from "@samur/shared";
import { getAlerts, getAlertsSituation } from "../services/api.js";
import type { AlertsSituation } from "../services/api.js";
import { Spinner } from "../components/Spinner.js";
import { SituationSummary } from "../components/alerts/SituationSummary.js";
import { AlertActions } from "../components/alerts/AlertActions.js";
import { useAlertsStore, isAlertNew } from "../store/alerts.js";

export function AlertsPage() {
  const alerts = useAlertsStore((s) => s.recentAlerts);
  const setAlerts = useAlertsStore((s) => s.setAlerts);
  const markAllRead = useAlertsStore((s) => s.markAllRead);

  const [situation, setSituation] = useState<AlertsSituation | null>(null);
  const [loading, setLoading] = useState(alerts.length === 0);
  const [dismissedCritical, setDismissedCritical] = useState<Set<string>>(new Set());

  // Snapshot the read-watermark at mount so cards newer than the snapshot
  // can render a "new" indicator — we then mark-all-read immediately, so
  // the visual survives the concurrent store update.
  const snapshotRef = useRef<string>(useAlertsStore.getState().lastReadAt);

  const fetchAll = useCallback(async () => {
    try {
      const [alertsRes, situationRes] = await Promise.all([
        getAlerts({ active: true, limit: 50, sort: "sent_at", order: "desc" }),
        getAlertsSituation().catch(() => null),
      ]);
      setAlerts((alertsRes.data ?? []) as Alert[]);
      if (situationRes?.data) setSituation(situationRes.data);
    } catch {
      // silent — badge/summary failures don't block the page
    } finally {
      setLoading(false);
    }
  }, [setAlerts]);

  useEffect(() => {
    fetchAll();
    markAllRead();
  }, [fetchAll, markAllRead]);

  // Browser-level notification for critical alerts that arrive while the
  // tab is open. (Badge/cache updates happen globally in Layout now.)
  useEffect(() => {
    const newest = alerts[0];
    if (!newest || newest.urgency !== "critical") return;
    if (!isAlertNew(newest, snapshotRef.current)) return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      new Notification("Кунак — КРИТИЧЕСКОЕ", {
        body: newest.title,
        icon: "/icons/icon-192.png",
        tag: newest.id,
      });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") {
          new Notification("Кунак — КРИТИЧЕСКОЕ", {
            body: newest.title,
            icon: "/icons/icon-192.png",
            tag: newest.id,
          });
        }
      });
    }
  }, [alerts]);

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
        <div
          key={a.id}
          className={`alert-banner alert-banner--critical${isAlertNew(a, snapshotRef.current) ? " alert-banner--new" : ""}`}
        >
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
            <AlertCard key={a.id} alert={a} isNew={isAlertNew(a, snapshotRef.current)} />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertCard({ alert, isNew }: { alert: Alert; isNew: boolean }) {
  const colorClass =
    alert.urgency === "critical"
      ? "alert-card--critical"
      : alert.urgency === "warning"
        ? "alert-card--warning"
        : "alert-card--info";

  const sourceIcon = ALERT_SOURCE_ICONS[alert.source] ?? "📢";
  const sourceLabel = ALERT_SOURCE_LABELS[alert.source] ?? "Оповещение";

  return (
    <div className={`alert-card ${colorClass}${isNew ? " alert-card--new" : ""}`}>
      <div className="alert-card-header">
        {isNew && <span className="alert-new-dot" aria-label="Новое" />}
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
