// SPDX-License-Identifier: AGPL-3.0-only
import TelegramBot from "node-telegram-bot-api";
import { config } from "./config.js";
import { addSubscriber } from "./broadcast.js";
import { initBroadcastListener } from "./broadcast.js";
import { startQueueProcessor } from "./queue.js";
import { redis } from "./redis.js";

// Handlers
import { registerStartHandler } from "./handlers/start.js";
import { registerReportHandler, handleReportCallback, startReportFlow } from "./handlers/report.js";
import { registerHelpHandler, handleHelpCallback, startHelpFlow } from "./handlers/help.js";
import { registerStatusHandler, handleCancelCallback, sendStatus } from "./handlers/status.js";
import { registerSheltersHandler, sendShelters } from "./handlers/shelters.js";
import { registerAlertsHandler, sendAlerts } from "./handlers/alerts.js";
import { registerLevelHandler } from "./handlers/level.js";
import { registerGroupHandler } from "./handlers/group.js";
import { registerTextHandler } from "./handlers/text.js";
import { registerSOSHandler, handleSOSCallback, isInSOSFlow, handleSOSLocation, cancelSOSFlow } from "./handlers/sos.js";

// Connect Redis (lazy — triggers actual connection)
redis.connect().catch((err) => {
  console.error("Redis connect failed:", err.message);
});

const bot = new TelegramBot(config.TG_BOT_TOKEN, { polling: true });

console.log("Starting Kunak Telegram bot...");

// Register command handlers
registerStartHandler(bot);
registerReportHandler(bot);
registerHelpHandler(bot);
registerStatusHandler(bot);
registerSheltersHandler(bot);
registerAlertsHandler(bot);
registerLevelHandler(bot);
registerSOSHandler(bot);
registerGroupHandler(bot);

// Text/location handler must be registered last — it's a catch-all
registerTextHandler(bot);

// Callback query router
bot.on("callback_query", async (query) => {
  const chatId = query.message?.chat.id;
  if (!chatId || !query.data) {
    await bot.answerCallbackQuery(query.id);
    return;
  }

  const data = query.data;
  const messageId = query.message!.message_id;
  const fromId = query.from.id;
  const fromName =
    [query.from.first_name, query.from.last_name].filter(Boolean).join(" ") ||
    "Пользователь";

  try {
    // Command shortcuts from inline keyboards
    if (data === "cmd:report") {
      await bot.answerCallbackQuery(query.id);
      await startReportFlow(bot, chatId);
      return;
    }
    if (data === "cmd:help") {
      await bot.answerCallbackQuery(query.id);
      await startHelpFlow(bot, chatId);
      return;
    }
    if (data === "cmd:shelters") {
      await bot.answerCallbackQuery(query.id);
      await sendShelters(bot, chatId);
      return;
    }
    if (data === "cmd:alerts") {
      await bot.answerCallbackQuery(query.id);
      await sendAlerts(bot, chatId);
      return;
    }
    if (data === "cmd:status") {
      await bot.answerCallbackQuery(query.id);
      await sendStatus(bot, chatId, fromId, fromName);
      return;
    }

    // Report flow callbacks
    if (data.startsWith("report:")) {
      await handleReportCallback(bot, chatId, data, messageId);
      await bot.answerCallbackQuery(query.id);
      return;
    }

    // Help flow callbacks
    if (data.startsWith("help:")) {
      await handleHelpCallback(bot, chatId, data, messageId);
      await bot.answerCallbackQuery(query.id);
      return;
    }

    // SOS flow callbacks
    if (data.startsWith("sos:")) {
      await handleSOSCallback(bot, chatId, data, messageId, fromId, fromName);
      await bot.answerCallbackQuery(query.id);
      return;
    }

    // Cancel help request
    if (data.startsWith("cancel:")) {
      await handleCancelCallback(bot, chatId, data, messageId, fromId, fromName);
      await bot.answerCallbackQuery(query.id);
      return;
    }
  } catch (err) {
    console.error("Callback query error:", err);
  }

  await bot.answerCallbackQuery(query.id);
});

// Register every user who contacts the bot as a broadcast subscriber
bot.on("message", async (msg) => {
  await addSubscriber(msg.chat.id);
});

// Start broadcast listener (Socket.IO → Telegram)
// Needs JWT to connect to the authenticated Socket.IO server
let broadcastSocket: ReturnType<typeof initBroadcastListener>;
(async () => {
  try {
    const { authenticateForPWA } = await import("./api.js");
    const botInfo = await bot.getMe();
    const result = await authenticateForPWA(botInfo.id, botInfo.first_name, botInfo.last_name);
    broadcastSocket = initBroadcastListener(bot, result.token);
    console.log("Broadcast listener authenticated");
  } catch (err) {
    console.error("Failed to auth broadcast listener:", (err as Error).message);
    broadcastSocket = initBroadcastListener(bot);
  }
})();

// Start offline queue processor
startQueueProcessor(async (entry) => {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${entry.token}`,
    };

    const res = await fetch(
      `${config.API_BASE_URL}/api/v1${entry.path}`,
      {
        method: entry.method,
        headers,
        body: JSON.stringify(entry.body),
      },
    );

    // 2xx = success, 4xx = permanent failure (don't retry)
    return res.ok || (res.status >= 400 && res.status < 500);
  } catch {
    return false;
  }
});

// Set bot commands menu
bot
  .setMyCommands([
    { command: "start", description: "Начать работу с ботом" },
    { command: "sos", description: "🆘 Я в беде — экстренный сигнал" },
    { command: "report", description: "Сообщить об инциденте" },
    { command: "help", description: "Попросить или предложить помощь" },
    { command: "status", description: "Проверить статус заявок" },
    { command: "shelters", description: "Найти укрытия" },
    { command: "alerts", description: "Последние оповещения" },
    { command: "level", description: "Уровень рек" },
  ])
  .then(() => console.log("Bot commands menu set"))
  .catch((err) => console.error("Failed to set commands:", err));

console.log("Kunak Telegram bot is running");

// Graceful shutdown
function shutdown(signal: string): void {
  console.log(`\n${signal} received, shutting down bot...`);
  bot.stopPolling();
  broadcastSocket?.disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
