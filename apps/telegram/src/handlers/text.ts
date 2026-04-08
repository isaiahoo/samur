// SPDX-License-Identifier: AGPL-3.0-only
import type TelegramBot from "node-telegram-bot-api";
import { getState } from "../state.js";
import { handleReportMessage } from "./report.js";
import { handleHelpMessage } from "./help.js";

const INTENT_PATTERNS: { pattern: RegExp; suggestion: string; command: string }[] = [
  {
    pattern: /помо[гщ]|нуж[ен|на|но]/i,
    suggestion: "Похоже, вам нужна помощь. Используйте /help",
    command: "cmd:help",
  },
  {
    pattern: /затоп|вод[аы]|паводок|наводн/i,
    suggestion: "Хотите сообщить об инциденте? Используйте /report",
    command: "cmd:report",
  },
  {
    pattern: /убежищ|укрыт|ночев|переноч|спрят/i,
    suggestion: "Ищете укрытие? Используйте /shelters",
    command: "cmd:shelters",
  },
];

export function registerTextHandler(bot: TelegramBot): void {
  bot.on("message", async (msg) => {
    if (!msg.text && !msg.location && !msg.photo && !msg.contact) return;

    const chatId = msg.chat.id;

    // Don't handle messages in groups (only commands)
    if (msg.chat.type !== "private") return;

    // Skip if it's a command
    if (msg.text?.startsWith("/")) return;

    // Check if user is in a conversation flow
    const state = getState(chatId);
    if (state) {
      if (state.flow === "report") {
        const handled = await handleReportMessage(bot, msg);
        if (handled) return;
      }
      if (state.flow === "help") {
        const handled = await handleHelpMessage(bot, msg);
        if (handled) return;
      }
    }

    // No active flow — try intent parsing on text messages
    if (msg.text) {
      for (const { pattern, suggestion, command } of INTENT_PATTERNS) {
        if (pattern.test(msg.text)) {
          await bot.sendMessage(chatId, suggestion, {
            reply_markup: {
              inline_keyboard: [
                [{ text: "Да, начать", callback_data: command }],
              ],
            },
          });
          return;
        }
      }
    }

    // Location sent outside of flow — show shelters
    if (msg.location) {
      const { sendShelters } = await import("./shelters.js");
      await sendShelters(bot, chatId, msg.location.latitude, msg.location.longitude);
      return;
    }

    // Fallback
    await bot.sendMessage(
      chatId,
      "Не понял вас. Вот что я умею:",
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "📍 Сообщить", callback_data: "cmd:report" },
              { text: "🤝 Помощь", callback_data: "cmd:help" },
            ],
            [
              { text: "🏠 Укрытия", callback_data: "cmd:shelters" },
              { text: "🔔 Оповещения", callback_data: "cmd:alerts" },
            ],
          ],
        },
      },
    );
  });
}
