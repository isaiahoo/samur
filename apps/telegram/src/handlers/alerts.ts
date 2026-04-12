// SPDX-License-Identifier: AGPL-3.0-only
import type TelegramBot from "node-telegram-bot-api";
import { getLatestAlerts } from "../api.js";
import { ALERT_URGENCY_LABELS } from "@samur/shared";

const URGENCY_EMOJI: Record<string, string> = {
  info: "ℹ️",
  warning: "⚠️",
  critical: "🚨",
};

export async function sendAlerts(bot: TelegramBot, chatId: number): Promise<void> {
  try {
    const alerts = await getLatestAlerts();

    if (alerts.length === 0) {
      await bot.sendMessage(chatId, "Нет активных оповещений.");
      return;
    }

    let text = "*🔔 Последние оповещения:*\n\n";

    for (const alert of alerts) {
      const emoji = URGENCY_EMOJI[alert.urgency] ?? "📢";
      const label = ALERT_URGENCY_LABELS[alert.urgency] ?? alert.urgency;
      text += `${emoji} *${alert.title}* [${label}]\n`;
      text += `${alert.body}\n`;
      if (alert.expiresAt) {
        const exp = new Date(alert.expiresAt);
        text += `⏰ До: ${exp.toLocaleString("ru-RU")}\n`;
      }
      text += "\n";
    }

    await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  } catch {
    await bot.sendMessage(
      chatId,
      "⚠️ Не удалось загрузить оповещения. Попробуйте позже.",
    );
  }
}

export function registerAlertsHandler(bot: TelegramBot): void {
  bot.onText(/\/alerts/, async (msg) => {
    await sendAlerts(bot, msg.chat.id);
  });
}
