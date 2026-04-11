// SPDX-License-Identifier: AGPL-3.0-only
import type TelegramBot from "node-telegram-bot-api";
import { getToken } from "../auth.js";
import { redis } from "../redis.js";
import { getMe } from "../api.js";

/**
 * Handle deep link login: /start login_TOKEN
 * Authenticates user via bot, stores JWT in Redis for PWA to pick up.
 */
async function handleDeepLinkLogin(
  bot: TelegramBot,
  chatId: number,
  tgId: number,
  name: string,
  authToken: string,
): Promise<void> {
  // Check if this auth token exists and is pending
  const value = await redis.get(`tg_auth:${authToken}`);
  if (!value || value !== "pending") {
    await bot.sendMessage(chatId, "Ссылка для входа устарела. Попробуйте снова на сайте.");
    return;
  }

  try {
    // Get JWT for this user
    const jwt = await getToken(chatId, tgId, name);

    // Fetch user info
    const user = await getMe(jwt);

    // Store result in Redis for the PWA to pick up
    await redis.set(
      `tg_auth:${authToken}`,
      JSON.stringify({ jwt, user }),
      "EX",
      300,
    );

    await bot.sendMessage(
      chatId,
      "Вход выполнен! Вернитесь на сайт — вы будете авторизованы автоматически.",
    );
  } catch (err) {
    console.error("Deep link login error:", err);
    await bot.sendMessage(chatId, "Ошибка авторизации. Попробуйте снова.");
  }
}

export function registerStartHandler(bot: TelegramBot): void {
  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const name =
      [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") ||
      "Пользователь";

    const payload = match?.[1]?.trim();

    // Handle deep link login
    if (payload?.startsWith("login_")) {
      const authToken = payload.slice(6); // remove "login_" prefix
      await handleDeepLinkLogin(bot, chatId, msg.from!.id, name, authToken);
      return;
    }

    // Ensure user is registered on first contact
    try {
      await getToken(chatId, msg.from!.id, name);
    } catch {
      // Non-fatal — user can still browse public commands
    }

    await bot.sendMessage(
      chatId,
      `Здравствуйте, ${name}! 👋\n\n` +
        "Я бот *Самур* — координация помощи при наводнении в Дагестане.\n\n" +
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
