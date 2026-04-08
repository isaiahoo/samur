// SPDX-License-Identifier: AGPL-3.0-only
import type TelegramBot from "node-telegram-bot-api";
import { getShelters } from "../api.js";
import { calculateDistance, SHELTER_STATUS_LABELS } from "@samur/shared";
import type { Shelter } from "@samur/shared";

export function registerSheltersHandler(bot: TelegramBot): void {
  bot.onText(/\/shelters/, async (msg) => {
    const chatId = msg.chat.id;

    let lat: number | undefined;
    let lng: number | undefined;

    if (msg.location) {
      lat = msg.location.latitude;
      lng = msg.location.longitude;
    }

    await sendShelters(bot, chatId, lat, lng);
  });
}

export async function sendShelters(
  bot: TelegramBot,
  chatId: number,
  lat?: number,
  lng?: number,
): Promise<void> {
  try {
    let shelters = await getShelters(lat, lng);

    if (shelters.length === 0) {
      await bot.sendMessage(chatId, "Открытых укрытий не найдено.");
      return;
    }

    // Sort by distance if user provided location
    if (lat !== undefined && lng !== undefined) {
      shelters = shelters
        .map((s) => ({
          ...s,
          dist: calculateDistance(lat, lng, s.lat, s.lng),
        }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 5);
    } else {
      shelters = shelters.slice(0, 5);
    }

    let text = "*🏠 Укрытия:*\n\n";

    for (const s of shelters as (Shelter & { dist?: number })[]) {
      const status = SHELTER_STATUS_LABELS[s.status] ?? s.status;
      const occupancy = `${s.currentOccupancy}/${s.capacity}`;
      const distStr =
        "dist" in s && typeof s.dist === "number"
          ? ` (${s.dist < 1 ? `${Math.round(s.dist * 1000)} м` : `${s.dist.toFixed(1)} км`})`
          : "";

      text += `*${s.name}*${distStr}\n`;
      text += `📍 ${s.address}\n`;
      text += `👥 ${occupancy} | ${status}\n`;
      if (s.contactPhone) text += `📞 ${s.contactPhone}\n`;
      text += `🗺️ [Маршрут](https://yandex.ru/maps/?rtext=~${s.lat},${s.lng}&rtt=auto)\n\n`;
    }

    await bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  } catch {
    await bot.sendMessage(
      chatId,
      "⚠️ Не удалось загрузить укрытия. Попробуйте позже.",
    );
  }
}
