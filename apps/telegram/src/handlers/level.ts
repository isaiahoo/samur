// SPDX-License-Identifier: AGPL-3.0-only
import type TelegramBot from "node-telegram-bot-api";
import { getLatestRiverLevels } from "../api.js";
import { RIVER_TREND_LABELS } from "@samur/shared";

const TREND_EMOJI: Record<string, string> = {
  rising: "📈",
  stable: "➡️",
  falling: "📉",
};

export function registerLevelHandler(bot: TelegramBot): void {
  bot.onText(/\/level/, async (msg) => {
    const chatId = msg.chat.id;

    try {
      const levels = await getLatestRiverLevels();

      if (levels.length === 0) {
        await bot.sendMessage(chatId, "Нет данных об уровне рек.");
        return;
      }

      let text = "*🌊 Уровень рек:*\n\n";

      for (const lv of levels) {
        const trend = TREND_EMOJI[lv.trend] ?? "";
        const trendLabel = RIVER_TREND_LABELS[lv.trend] ?? lv.trend;
        const ratio = lv.dangerLevelCm > 0 ? lv.levelCm / lv.dangerLevelCm : 0;
        const danger = ratio >= 1 ? "🔴" : ratio >= 0.8 ? "🟡" : "🟢";

        text += `${danger} *${lv.riverName}* (${lv.stationName})\n`;
        text += `   ${lv.levelCm} см / ${lv.dangerLevelCm} см ${trend} ${trendLabel}\n`;
        text += `   📅 ${new Date(lv.measuredAt).toLocaleString("ru-RU")}\n\n`;
      }

      await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
    } catch {
      await bot.sendMessage(
        chatId,
        "⚠️ Не удалось загрузить данные. Попробуйте позже.",
      );
    }
  });
}
