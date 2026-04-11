// SPDX-License-Identifier: AGPL-3.0-only
import type TelegramBot from "node-telegram-bot-api";
import { getToken } from "../auth.js";
import { createSOS } from "../api.js";
import { checkRateLimit, recordAction } from "../rateLimit.js";
import { enqueue } from "../queue.js";
import { SOS_SITUATION_LABELS } from "@samur/shared";
import type { SosSituation } from "@samur/shared";

const SITUATIONS = Object.keys(SOS_SITUATION_LABELS) as SosSituation[];

export function registerSOSHandler(bot: TelegramBot): void {
  bot.onText(/\/sos$/, async (msg) => {
    const chatId = msg.chat.id;

    if (!checkRateLimit(chatId)) {
      await bot.sendMessage(
        chatId,
        "⚠️ Вы превысили лимит сообщений. Попробуйте позже.",
      );
      return;
    }

    await bot.sendMessage(
      chatId,
      "🆘 *SOS — Экстренный сигнал*\n\n" +
        "Отправьте вашу геолокацию для немедленной отправки сигнала SOS.\n\n" +
        "📍 Нажмите кнопку ниже или отправьте местоположение:",
      {
        parse_mode: "Markdown",
        reply_markup: {
          keyboard: [
            [{ text: "📍 Отправить местоположение", request_location: true }],
            [{ text: "Отмена" }],
          ],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      },
    );

    // Store that user is in SOS flow
    sosFlowChats.add(chatId);
  });
}

// Track which chats are in SOS flow (waiting for location)
const sosFlowChats = new Set<number>();

export function isInSOSFlow(chatId: number): boolean {
  return sosFlowChats.has(chatId);
}

export async function handleSOSLocation(
  bot: TelegramBot,
  chatId: number,
  lat: number,
  lng: number,
  fromId: number,
  fromName: string,
): Promise<void> {
  sosFlowChats.delete(chatId);

  // Ask for situation type
  await bot.sendMessage(
    chatId,
    "Выберите ситуацию (необязательно):",
    {
      reply_markup: {
        inline_keyboard: [
          ...SITUATIONS.map((sit) => [
            { text: SOS_SITUATION_LABELS[sit], callback_data: `sos:sit:${sit}:${lat}:${lng}` },
          ]),
          [{ text: "⚡ Отправить сразу", callback_data: `sos:send:${lat}:${lng}` }],
        ],
        remove_keyboard: true,
      },
    },
  );
}

export async function handleSOSCallback(
  bot: TelegramBot,
  chatId: number,
  data: string,
  messageId: number,
  fromId: number,
  fromName: string,
): Promise<void> {
  let lat: number;
  let lng: number;
  let situation: string | undefined;

  if (data.startsWith("sos:sit:")) {
    const parts = data.split(":");
    situation = parts[2];
    lat = parseFloat(parts[3]);
    lng = parseFloat(parts[4]);
  } else if (data.startsWith("sos:send:")) {
    const parts = data.split(":");
    lat = parseFloat(parts[2]);
    lng = parseFloat(parts[3]);
  } else {
    return;
  }

  try {
    const token = await getToken(chatId, fromId, fromName);
    const result = await createSOS(
      {
        lat,
        lng,
        situation,
        contactName: fromName,
      },
      token,
    );

    recordAction(chatId);

    const sitLabel = situation
      ? SOS_SITUATION_LABELS[situation] ?? situation
      : "Не указана";

    await bot.editMessageText(
      `✅ *SOS сигнал отправлен*\n\n` +
        `📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}\n` +
        `🔴 ${sitLabel}\n` +
        `🆔 ${result.id.slice(0, 8)}\n\n` +
        `Ожидайте помощи. Координаторы и волонтёры уведомлены.`,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "Markdown",
      },
    );
  } catch (err) {
    console.error("SOS send error:", err);

    // Queue for offline retry
    try {
      const token = await getToken(chatId, fromId, fromName);
      await enqueue(
        chatId,
        "POST",
        "/help-requests/sos",
        { lat, lng, situation, contactName: fromName, source: "telegram" },
        token,
      );
      await bot.editMessageText(
        "⚠️ Ошибка связи с сервером. Сигнал сохранён и будет отправлен при восстановлении.",
        { chat_id: chatId, message_id: messageId },
      );
    } catch {
      await bot.editMessageText(
        "❌ Не удалось отправить SOS. Попробуйте ещё раз: /sos",
        { chat_id: chatId, message_id: messageId },
      );
    }
  }
}

export function cancelSOSFlow(chatId: number): void {
  sosFlowChats.delete(chatId);
}
