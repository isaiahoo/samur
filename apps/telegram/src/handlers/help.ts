// SPDX-License-Identifier: AGPL-3.0-only
import type TelegramBot from "node-telegram-bot-api";
import { getState, setState, clearState, type HelpState } from "../state.js";
import { getToken } from "../auth.js";
import { checkRateLimit, recordAction } from "../rateLimit.js";
import { createHelpRequest, ApiError } from "../api.js";
import { enqueue } from "../queue.js";
import { HELP_CATEGORY_LABELS, isInDagestan } from "@samur/shared";

const CATEGORY_EMOJIS: Record<string, string> = {
  rescue: "🚁",
  shelter: "🏠",
  food: "🍞",
  water: "💧",
  medicine: "💊",
  equipment: "🔧",
  transport: "🚗",
  labor: "💪",
  generator: "⚡",
  pump: "🔧",
};

export async function startHelpFlow(bot: TelegramBot, chatId: number): Promise<void> {
  if (!checkRateLimit(chatId)) {
    await bot.sendMessage(
      chatId,
      "⚠️ Вы превысили лимит сообщений (5 в час). Попробуйте позже.",
    );
    return;
  }

  await setState(chatId, { flow: "help", step: "kind" });

  await bot.sendMessage(
    chatId,
    "Вам нужна помощь или вы готовы помочь?",
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🆘 Нужна помощь", callback_data: "help:kind:need" },
            { text: "🤝 Готов помочь", callback_data: "help:kind:offer" },
          ],
        ],
      },
    },
  );
}

export function registerHelpHandler(bot: TelegramBot): void {
  bot.onText(/\/help$/, async (msg) => {
    await startHelpFlow(bot, msg.chat.id);
  });
}

export async function handleHelpCallback(
  bot: TelegramBot,
  chatId: number,
  data: string,
  messageId: number,
): Promise<void> {
  const state = await getState(chatId) as HelpState | null;
  if (!state || state.flow !== "help") return;

  // help:kind:<need|offer>
  if (data.startsWith("help:kind:") && state.step === "kind") {
    const kind = data.replace("help:kind:", "") as "need" | "offer";
    await setState(chatId, { ...state, step: "category", kind });

    const buttons = Object.entries(HELP_CATEGORY_LABELS).map(
      ([key, label]) => ({
        text: `${CATEGORY_EMOJIS[key] ?? ""} ${label}`,
        callback_data: `help:cat:${key}`,
      }),
    );

    const keyboard: TelegramBot.InlineKeyboardButton[][] = [];
    for (let i = 0; i < buttons.length; i += 2) {
      keyboard.push(buttons.slice(i, i + 2));
    }

    await bot.editMessageText("Выберите категорию:", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: keyboard },
    });
    return;
  }

  // help:cat:<category>
  if (data.startsWith("help:cat:") && state.step === "category") {
    const category = data.replace("help:cat:", "");
    await setState(chatId, { ...state, step: "location", category });

    await bot.editMessageText(
      `✅ ${HELP_CATEGORY_LABELS[category] ?? category}\n\nОтправьте геолокацию 📍 или напишите адрес:`,
      { chat_id: chatId, message_id: messageId },
    );
    return;
  }
}

export async function handleHelpMessage(
  bot: TelegramBot,
  msg: TelegramBot.Message,
): Promise<boolean> {
  const chatId = msg.chat.id;
  const state = await getState(chatId) as HelpState | null;
  if (!state || state.flow !== "help") return false;

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
        step: "description",
        lat: latitude,
        lng: longitude,
      });
    } else if (msg.text) {
      await setState(chatId, {
        ...state,
        step: "description",
        address: msg.text,
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

    await bot.sendMessage(chatId, "Опишите ситуацию:");
    return true;
  }

  // Description step
  if (state.step === "description") {
    if (!msg.text) {
      await bot.sendMessage(chatId, "Напишите описание.");
      return true;
    }
    await setState(chatId, { ...state, step: "contact", description: msg.text });

    await bot.sendMessage(
      chatId,
      "Укажите контактный телефон (или отправьте /skip):",
    );
    return true;
  }

  // Contact step
  if (state.step === "contact") {
    let contactPhone: string | undefined;
    let contactName: string | undefined;

    if (msg.contact) {
      contactPhone = msg.contact.phone_number;
      contactName = [msg.contact.first_name, msg.contact.last_name]
        .filter(Boolean)
        .join(" ");
    } else if (msg.text && msg.text !== "/skip") {
      contactPhone = msg.text;
    }

    contactName =
      contactName ||
      [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ");

    await setState(chatId, {
      ...state,
      step: "done",
      contactPhone,
      contactName,
    });

    await submitHelp(bot, chatId, msg);
    return true;
  }

  return true;
}

async function submitHelp(
  bot: TelegramBot,
  chatId: number,
  msg: TelegramBot.Message,
): Promise<void> {
  const state = await getState(chatId) as HelpState;
  const name =
    [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") ||
    "Пользователь";

  try {
    const token = await getToken(chatId, msg.from!.id, name);

    const helpReq = await createHelpRequest(
      {
        type: state.kind!,
        category: state.category!,
        lat: state.lat!,
        lng: state.lng!,
        address: state.address,
        description: state.description,
        urgency: state.kind === "need" ? "urgent" : "normal",
        contactPhone: state.contactPhone,
        contactName: state.contactName,
      },
      token,
    );

    recordAction(chatId);
    await clearState(chatId);

    const label = state.kind === "need" ? "Запрос помощи" : "Предложение помощи";
    await bot.sendMessage(
      chatId,
      `✅ ${label} отправлен!\nID: #${helpReq.id.slice(0, 8)}\n\nСпасибо!`,
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
      try {
        const token = await getToken(chatId, msg.from!.id, name);
        await enqueue(chatId, "POST", "/help-requests", {
          type: state.kind,
          category: state.category,
          lat: state.lat,
          lng: state.lng,
          address: state.address,
          description: state.description,
          urgency: state.kind === "need" ? "urgent" : "normal",
          contactPhone: state.contactPhone,
          contactName: state.contactName,
          source: "telegram",
        }, token);
      } catch {
        // ignore
      }
      await clearState(chatId);
      await bot.sendMessage(
        chatId,
        "⚠️ Сервер временно недоступен. Ваше сообщение сохранено и будет отправлено автоматически.",
      );
    }
  }
}
