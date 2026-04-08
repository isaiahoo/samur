// SPDX-License-Identifier: AGPL-3.0-only
import type TelegramBot from "node-telegram-bot-api";
import { getToken } from "../auth.js";

export function registerStartHandler(bot: TelegramBot): void {
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const name =
      [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") ||
      "Пользователь";

    // Ensure user is registered on first contact
    try {
      await getToken(chatId, msg.from!.id, name);
    } catch {
      // Non-fatal — user can still browse public commands
    }

    await bot.sendMessage(
      chatId,
      `Здравствуйте, ${name}! 👋\n\n` +
        "Я бот *ДагПомощь* — координация помощи при наводнении в Дагестане.\n\n" +
        "Вот что я умею:\n" +
        "📍 /report — Сообщить об инциденте\n" +
        "🤝 /help — Попросить или предложить помощь\n" +
        "📋 /status — Проверить статус ваших заявок\n" +
        "🏠 /shelters — Найти ближайшие укрытия\n" +
        "🔔 /alerts — Последние оповещения\n" +
        "🌊 /level — Уровень рек\n\n" +
        "Отправьте геолокацию для более точных результатов.",
      {
        parse_mode: "Markdown",
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
