// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect } from "react";
import {
  Panel,
  PanelHeader,
  Group,
  Banner,
  SimpleCell,
  Button,
  Div,
  Spinner,
  Snackbar,
} from "@vkontakte/vkui";
import { getAlerts } from "../services/api";
import { allowNotifications } from "../services/vkbridge";
import { ALERT_URGENCY_LABELS, ALERT_URGENCY_COLORS } from "@samur/shared";
import type { Alert } from "@samur/shared";

interface Props {
  id: string;
}

const URGENCY_EMOJI: Record<string, string> = {
  info: "ℹ️",
  warning: "⚠️",
  critical: "🚨",
};

export default function AlertsPanel({ id }: Props) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  useEffect(() => {
    loadAlerts();
  }, []);

  async function loadAlerts() {
    setLoading(true);
    try {
      const data = await getAlerts();
      setAlerts(data);
    } catch {
      setSnackbar("Ошибка загрузки оповещений");
    }
    setLoading(false);
  }

  async function handleSubscribe() {
    const ok = await allowNotifications();
    setSnackbar(
      ok
        ? "Уведомления включены"
        : "Не удалось включить уведомления",
    );
  }

  const critical = alerts.filter((a) => a.urgency === "critical");
  const others = alerts.filter((a) => a.urgency !== "critical");

  return (
    <Panel id={id}>
      <PanelHeader>Оповещения</PanelHeader>

      <Group>
        <Div>
          <Button size="m" mode="secondary" onClick={handleSubscribe}>
            🔔 Включить уведомления
          </Button>
        </Div>
      </Group>

      {loading ? (
        <Div style={{ textAlign: "center", padding: 32 }}>
          <Spinner />
        </Div>
      ) : alerts.length === 0 ? (
        <Div style={{ textAlign: "center", color: "#888", padding: 32 }}>
          Нет активных оповещений
        </Div>
      ) : (
        <>
          {critical.map((alert) => (
            <Banner
              key={alert.id}
              mode="error"
              header={`${URGENCY_EMOJI.critical} ${alert.title}`}
              subheader={alert.body}
              asideMode="dismiss"
            />
          ))}

          <Group>
            {others.map((alert) => {
              const emoji = URGENCY_EMOJI[alert.urgency] ?? "📢";
              const label =
                ALERT_URGENCY_LABELS[alert.urgency] ?? alert.urgency;
              const color = ALERT_URGENCY_COLORS[alert.urgency] ?? "#888";

              return (
                <SimpleCell
                  key={alert.id}
                  before={<span style={{ fontSize: 20 }}>{emoji}</span>}
                  subtitle={
                    <>
                      <span style={{ color }}>{label}</span>
                      {alert.expiresAt && (
                        <span style={{ marginLeft: 8, color: "#888", fontSize: 12 }}>
                          до {new Date(alert.expiresAt).toLocaleDateString("ru-RU")}
                        </span>
                      )}
                    </>
                  }
                  multiline
                >
                  <strong>{alert.title}</strong>
                  <br />
                  <span style={{ color: "#555" }}>{alert.body}</span>
                </SimpleCell>
              );
            })}
          </Group>
        </>
      )}

      {snackbar && (
        <Snackbar onClose={() => setSnackbar(null)}>{snackbar}</Snackbar>
      )}
    </Panel>
  );
}
