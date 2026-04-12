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

        const hasLevel = lv.levelCm !== null && lv.levelCm !== undefined && lv.levelCm > 0;
        const hasDischarge = lv.dischargeCubicM !== null && lv.dischargeCubicM !== undefined && lv.dischargeCubicM > 0;

        let ratio = 0;
        if (hasLevel && lv.dangerLevelCm && lv.dangerLevelCm > 0) {
          ratio = lv.levelCm! / lv.dangerLevelCm;
        } else if (hasDischarge && lv.dischargeMax && lv.dischargeMax > 0) {
          ratio = lv.dischargeCubicM! / lv.dischargeMax;
        }
        const danger = ratio >= 1 ? "🔴" : ratio >= 0.8 ? "🟡" : "🟢";

        text += `${danger} *${lv.riverName}* (${lv.stationName})\n`;

        if (hasLevel) {
          text += `   ${lv.levelCm} см / ${lv.dangerLevelCm} см ${trend} ${trendLabel}\n`;
        } else if (hasDischarge) {
          const pctMean = lv.dischargeMean ? Math.round((lv.dischargeCubicM! / lv.dischargeMean) * 100) : null;
          text += `   💧 ${lv.dischargeCubicM} м³/с`;
          if (pctMean !== null) {
            const diff = pctMean - 100;
            if (diff === 0) text += ` (норма)`;
            else if (diff > 0) text += ` (на ${diff}% выше нормы)`;
            else text += ` (на ${Math.abs(diff)}% ниже нормы)`;
          }
          text += ` ${trend} ${trendLabel}\n`;
        } else {
          text += `   Нет данных\n`;
        }

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
