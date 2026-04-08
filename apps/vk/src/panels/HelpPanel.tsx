// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect } from "react";
import {
  Panel,
  PanelHeader,
  Group,
  Header,
  SimpleCell,
  Button,
  Div,
  Tabs,
  TabsItem,
  Badge,
  Snackbar,
  Spinner,
} from "@vkontakte/vkui";
import { getHelpRequests, claimHelpRequest } from "../services/api";
import {
  HELP_CATEGORY_LABELS,
  URGENCY_LABELS,
  HELP_REQUEST_STATUS_LABELS,
} from "@samur/shared";
import type { HelpRequest } from "@samur/shared";
import type { PanelId } from "../hooks/useNav";

interface Props {
  id: string;
  go: (panel: PanelId) => void;
}

export default function HelpPanel({ id, go }: Props) {
  const [tab, setTab] = useState<"need" | "offer">("need");
  const [items, setItems] = useState<HelpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [tab]);

  async function loadData() {
    setLoading(true);
    try {
      const data = await getHelpRequests(
        `type=${tab}&status=open&limit=20&sort=createdAt&order=desc`,
      );
      setItems(data);
    } catch {
      setSnackbar("Ошибка загрузки");
    }
    setLoading(false);
  }

  async function handleClaim(hr: HelpRequest) {
    try {
      await claimHelpRequest(hr.id);
      setSnackbar("Вы откликнулись на заявку");
      loadData();
    } catch {
      setSnackbar("Не удалось откликнуться");
    }
  }

  const urgencyEmoji: Record<string, string> = {
    normal: "🟢",
    urgent: "🟡",
    critical: "🔴",
  };

  return (
    <Panel id={id}>
      <PanelHeader>Помощь</PanelHeader>

      <Tabs>
        <TabsItem selected={tab === "need"} onClick={() => setTab("need")}>
          Нужна помощь
        </TabsItem>
        <TabsItem selected={tab === "offer"} onClick={() => setTab("offer")}>
          Предложения
        </TabsItem>
      </Tabs>

      <Group>
        <Div>
          <Button size="m" mode="primary" onClick={() => go("help-form")}>
            Создать заявку
          </Button>
        </Div>
      </Group>

      {loading ? (
        <Div style={{ textAlign: "center", padding: 32 }}>
          <Spinner />
        </Div>
      ) : items.length === 0 ? (
        <Div style={{ textAlign: "center", color: "#888", padding: 32 }}>
          Нет заявок
        </Div>
      ) : (
        <Group>
          {items.map((hr) => (
            <SimpleCell
              key={hr.id}
              before={
                <span style={{ fontSize: 20 }}>
                  {urgencyEmoji[hr.urgency] ?? "🟢"}
                </span>
              }
              subtitle={
                <>
                  {URGENCY_LABELS[hr.urgency] ?? hr.urgency}
                  {hr.address && ` · ${hr.address}`}
                  {hr.contactPhone && ` · 📞 ${hr.contactPhone}`}
                </>
              }
              after={
                tab === "need" ? (
                  <Button
                    size="s"
                    mode="secondary"
                    onClick={() => handleClaim(hr)}
                  >
                    Откликнуться
                  </Button>
                ) : undefined
              }
            >
              {HELP_CATEGORY_LABELS[hr.category] ?? hr.category}
              {hr.description && (
                <span style={{ color: "#888", marginLeft: 8, fontSize: 13 }}>
                  — {hr.description.slice(0, 60)}
                </span>
              )}
            </SimpleCell>
          ))}
        </Group>
      )}

      {snackbar && (
        <Snackbar onClose={() => setSnackbar(null)}>{snackbar}</Snackbar>
      )}
    </Panel>
  );
}
