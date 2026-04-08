// SPDX-License-Identifier: AGPL-3.0-only
import type TelegramBot from "node-telegram-bot-api";
import { getToken } from "../auth.js";
import { getUserIncidents, getUserHelpRequests, cancelHelpRequest } from "../api.js";
import {
  INCIDENT_TYPE_LABELS,
  INCIDENT_STATUS_LABELS,
  HELP_CATEGORY_LABELS,
  HELP_REQUEST_STATUS_LABELS,
} from "@samur/shared";

export function registerStatusHandler(bot: TelegramBot): void {
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const name =
      [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") ||
      "Пользователь";

    try {
      const token = await getToken(chatId, msg.from!.id, name);
      const [incidents, helpRequests] = await Promise.all([
        getUserIncidents(token),
        getUserHelpRequests(token),
      ]);

      if (incidents.length === 0 && helpRequests.length === 0) {
        await bot.sendMessage(chatId, "У вас пока нет заявок.");
        return;
      }

      let text = "";

      if (incidents.length > 0) {
        text += "*📍 Ваши инциденты:*\n";
        for (const inc of incidents.slice(0, 5)) {
          const type = INCIDENT_TYPE_LABELS[inc.type] ?? inc.type;
          const status = INCIDENT_STATUS_LABELS[inc.status] ?? inc.status;
          text += `• ${type} — ${status} (#${inc.id.slice(0, 8)})\n`;
        }
        text += "\n";
      }

      if (helpRequests.length > 0) {
        text += "*🤝 Ваши запросы помощи:*\n";
        const buttons: TelegramBot.InlineKeyboardButton[][] = [];

        for (const hr of helpRequests.slice(0, 5)) {
          const cat = HELP_CATEGORY_LABELS[hr.category] ?? hr.category;
          const status = HELP_REQUEST_STATUS_LABELS[hr.status] ?? hr.status;
          text += `• ${cat} — ${status} (#${hr.id.slice(0, 8)})\n`;

          if (hr.status === "open" || hr.status === "claimed") {
            buttons.push([
              {
                text: `❌ Отменить #${hr.id.slice(0, 8)}`,
                callback_data: `cancel:${hr.id}`,
              },
            ]);
          }
        }

        await bot.sendMessage(chatId, text, {
          parse_mode: "Markdown",
          reply_markup:
            buttons.length > 0 ? { inline_keyboard: buttons } : undefined,
        });
      } else {
        await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
      }
    } catch {
      await bot.sendMessage(
        chatId,
        "⚠️ Не удалось загрузить данные. Попробуйте позже.",
      );
    }
  });
}

export async function handleCancelCallback(
  bot: TelegramBot,
  chatId: number,
  data: string,
  messageId: number,
  fromId: number,
  fromName: string,
): Promise<void> {
  const id = data.replace("cancel:", "");
  try {
    const token = await getToken(chatId, fromId, fromName);
    await cancelHelpRequest(id, token);
    await bot.editMessageText(
      `✅ Запрос #${id.slice(0, 8)} отменён.`,
      { chat_id: chatId, message_id: messageId },
    );
  } catch {
    await bot.sendMessage(chatId, "❌ Не удалось отменить запрос.");
  }
}
