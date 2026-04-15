// SPDX-License-Identifier: AGPL-3.0-only
import type TelegramBot from "node-telegram-bot-api";
import { getToken } from "../auth.js";
import { createIncident } from "../api.js";
import { INCIDENT_TYPE_LABELS, isInDagestan } from "@samur/shared";

// Shorthand type aliases for the parser
const TYPE_ALIASES: Record<string, string> = {
  flood: "flood",
  "затоп": "flood",
  mudslide: "mudslide",
  "сель": "mudslide",
  landslide: "landslide",
  "оползень": "landslide",
  "оползн": "landslide",
  road: "road_blocked",
  "дорога": "road_blocked",
  building: "building_damaged",
  "здание": "building_damaged",
  power: "power_out",
  "электр": "power_out",
  water: "water_contaminated",
  "вода": "water_contaminated",
};

/**
 * /report_group <type> <lat,lng> <description>
 * Example: /report_group flood 42.9849,47.5047 Затопило подвалы на ул. Мира
 */
export function registerGroupHandler(bot: TelegramBot): void {
  bot.onText(/\/report_group\s+(.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const args = match![1].trim();

    const parts = args.split(/\s+/);
    if (parts.length < 3) {
      await bot.sendMessage(
        chatId,
        "Формат: /report\\_group <тип> <широта,долгота> <описание>\n" +
          "Пример: /report\\_group flood 42.9849,47.5047 Затопило подвалы",
        { parse_mode: "Markdown" },
      );
      return;
    }

    const typeInput = parts[0].toLowerCase();
    const type = TYPE_ALIASES[typeInput] ?? typeInput;
    if (!INCIDENT_TYPE_LABELS[type]) {
      const validTypes = Object.keys(TYPE_ALIASES).join(", ");
      await bot.sendMessage(
        chatId,
        `❌ Неизвестный тип. Допустимые: ${validTypes}`,
      );
      return;
    }

    const coordParts = parts[1].split(",");
    if (coordParts.length !== 2) {
      await bot.sendMessage(chatId, "❌ Координаты: широта,долгота (через запятую)");
      return;
    }

    const lat = parseFloat(coordParts[0]);
    const lng = parseFloat(coordParts[1]);
    if (isNaN(lat) || isNaN(lng) || !isInDagestan(lat, lng)) {
      await bot.sendMessage(chatId, "❌ Координаты вне территории Дагестана.");
      return;
    }

    const description = parts.slice(2).join(" ");
    const name =
      [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") ||
      "Пользователь";

    try {
      const token = await getToken(chatId, msg.from!.id, name);
      const incident = await createIncident(
        { type, severity: "medium", lat, lng, description },
        token,
      );

      await bot.sendMessage(
        chatId,
        `✅ Инцидент зарегистрирован: ${INCIDENT_TYPE_LABELS[type]} (#${incident.id.slice(0, 8)})`,
      );
    } catch {
      await bot.sendMessage(chatId, "⚠️ Не удалось отправить. Попробуйте позже.");
    }
  });
}
