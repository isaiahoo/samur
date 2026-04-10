// SPDX-License-Identifier: AGPL-3.0-only
import type TelegramBot from "node-telegram-bot-api";
import { getState, setState, clearState, type ReportState } from "../state.js";
import { getToken } from "../auth.js";
import { checkRateLimit, recordAction } from "../rateLimit.js";
import { createIncident, ApiError } from "../api.js";
import { enqueue } from "../queue.js";
import {
  INCIDENT_TYPE_LABELS,
  SEVERITY_LABELS,
  isInDagestan,
} from "@samur/shared";

const TYPE_EMOJIS: Record<string, string> = {
  flood: "🌊",
  road_blocked: "🚧",
  building_damaged: "🏚️",
  power_out: "💡",
  water_contaminated: "🚰",
};

export function registerReportHandler(bot: TelegramBot): void {
  bot.onText(/\/report$/, async (msg) => {
    const chatId = msg.chat.id;

    if (!checkRateLimit(chatId)) {
      await bot.sendMessage(
        chatId,
        "⚠️ Вы превысили лимит сообщений (5 в час). Попробуйте позже.",
      );
      return;
    }

    await setState(chatId, { flow: "report", step: "type" });

    const buttons = Object.entries(INCIDENT_TYPE_LABELS).map(
      ([key, label]) => ({
        text: `${TYPE_EMOJIS[key] ?? ""} ${label}`,
        callback_data: `report:type:${key}`,
      }),
    );

    // 2 buttons per row
    const keyboard: TelegramBot.InlineKeyboardButton[][] = [];
    for (let i = 0; i < buttons.length; i += 2) {
      keyboard.push(buttons.slice(i, i + 2));
    }

    await bot.sendMessage(chatId, "Что случилось?", {
      reply_markup: { inline_keyboard: keyboard },
    });
  });
}

export async function handleReportCallback(
  bot: TelegramBot,
  chatId: number,
  data: string,
  messageId: number,
): Promise<void> {
  const state = await getState(chatId) as ReportState | null;
  if (!state || state.flow !== "report") return;

  // report:type:<type>
  if (data.startsWith("report:type:") && state.step === "type") {
    const type = data.replace("report:type:", "");
    await setState(chatId, { ...state, step: "location", type });

    await bot.editMessageText(
      `✅ ${INCIDENT_TYPE_LABELS[type] ?? type}\n\nОтправьте геолокацию 📍 или напишите адрес:`,
      { chat_id: chatId, message_id: messageId },
    );
    return;
  }

  // report:severity:<level>
  if (data.startsWith("report:severity:") && state.step === "severity") {
    const severity = data.replace("report:severity:", "");
    await setState(chatId, { ...state, step: "description", severity });

    await bot.editMessageText(
      `✅ Серьёзность: ${SEVERITY_LABELS[severity] ?? severity}\n\nОпишите ситуацию (можно приложить фото):`,
      { chat_id: chatId, message_id: messageId },
    );
    return;
  }
}

export async function handleReportMessage(
  bot: TelegramBot,
  msg: TelegramBot.Message,
): Promise<boolean> {
  const chatId = msg.chat.id;
  const state = await getState(chatId) as ReportState | null;
  if (!state || state.flow !== "report") return false;

  // Location step
  if (state.step === "location") {
    if (msg.location) {
      const { latitude, longitude } = msg.location;
      if (!isInDagestan(latitude, longitude)) {
        await bot.sendMessage(
          chatId,
          "⚠️ Координаты вне территории Дагестана. Попробуйте снова.",
        );
        return true;
      }
      await setState(chatId, {
        ...state,
        step: "severity",
        lat: latitude,
        lng: longitude,
      });
    } else if (msg.text) {
      await setState(chatId, {
        ...state,
        step: "severity",
        address: msg.text,
        // Default to Makhachkala center if no coordinates
        lat: 42.9849,
        lng: 47.5047,
      });
    } else {
      await bot.sendMessage(
        chatId,
        "Отправьте геолокацию или напишите адрес.",
      );
      return true;
    }

    await bot.sendMessage(chatId, "Насколько серьёзно?", {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🟢 Некритично",
              callback_data: "report:severity:low",
            },
            {
              text: "🟡 Серьёзно",
              callback_data: "report:severity:medium",
            },
            {
              text: "🔴 Критично",
              callback_data: "report:severity:critical",
            },
          ],
        ],
      },
    });
    return true;
  }

  // Description step
  if (state.step === "description") {
    const description = msg.text ?? "";
    const photoUrls: string[] = [];

    if (msg.photo && msg.photo.length > 0) {
      // Get highest resolution photo
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      photoUrls.push(fileId);
    }

    if (!description && photoUrls.length === 0) {
      await bot.sendMessage(
        chatId,
        "Напишите описание или отправьте фото.",
      );
      return true;
    }

    // Submit the report
    await setState(chatId, { ...state, step: "done", description, photoUrls });
    await submitReport(bot, chatId, msg);
    return true;
  }

  return true;
}

async function submitReport(
  bot: TelegramBot,
  chatId: number,
  msg: TelegramBot.Message,
): Promise<void> {
  const state = await getState(chatId) as ReportState;
  const name =
    [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") ||
    "Пользователь";

  try {
    const token = await getToken(chatId, msg.from!.id, name);

    const incident = await createIncident(
      {
        type: state.type!,
        severity: state.severity!,
        lat: state.lat!,
        lng: state.lng!,
        address: state.address,
        description: state.description,
        photoUrls: state.photoUrls,
      },
      token,
    );

    recordAction(chatId);
    await clearState(chatId);

    await bot.sendMessage(
      chatId,
      `✅ Ваше сообщение отправлено!\nID: #${incident.id.slice(0, 8)}\n\nМы передадим координаторам. Спасибо!`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📋 Мои заявки", callback_data: "cmd:status" }],
          ],
        },
      },
    );
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      await clearState(chatId);
      await bot.sendMessage(chatId, `❌ Ошибка: ${err.message}`);
    } else {
      // API unreachable — queue for retry
      try {
        const token = await getToken(chatId, msg.from!.id, name);
        await enqueue(chatId, "POST", "/incidents", {
          type: state.type,
          severity: state.severity,
          lat: state.lat,
          lng: state.lng,
          address: state.address,
          description: state.description,
          photoUrls: state.photoUrls,
          source: "telegram",
        }, token);
      } catch {
        // Can't even get token
      }
      await clearState(chatId);
      await bot.sendMessage(
        chatId,
        "⚠️ Сервер временно недоступен. Ваше сообщение сохранено и будет отправлено автоматически.",
      );
    }
  }
}

