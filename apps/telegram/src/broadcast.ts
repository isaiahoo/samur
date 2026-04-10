// SPDX-License-Identifier: AGPL-3.0-only
import { io, type Socket } from "socket.io-client";
import type TelegramBot from "node-telegram-bot-api";
import { config } from "./config.js";
import { redis } from "./redis.js";
import type { Alert, ServerToClientEvents, ClientToServerEvents } from "@samur/shared";
import { ALERT_URGENCY_LABELS } from "@samur/shared";

const SUBSCRIBERS_KEY = "tg:broadcast:subscribers";

export async function addSubscriber(chatId: number): Promise<void> {
  await redis.sadd(SUBSCRIBERS_KEY, String(chatId));
}

export async function removeSubscriber(chatId: number): Promise<void> {
  await redis.srem(SUBSCRIBERS_KEY, String(chatId));
}

export async function getSubscriberCount(): Promise<number> {
  return redis.scard(SUBSCRIBERS_KEY);
}

async function getSubscribers(): Promise<number[]> {
  const members = await redis.smembers(SUBSCRIBERS_KEY);
  return members.map(Number);
}

const URGENCY_EMOJI: Record<string, string> = {
  info: "ℹ️",
  warning: "⚠️",
  critical: "🚨",
};

export function initBroadcastListener(bot: TelegramBot): Socket {
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
    config.SOCKET_URL,
    {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 30_000,
    },
  );

  socket.on("connect", () => {
    console.log("Broadcast listener connected to API socket");
  });

  socket.on("disconnect", (reason) => {
    console.log(`Broadcast listener disconnected: ${reason}`);
  });

  (socket as unknown as { on: (ev: string, fn: (alert: Alert) => void) => void }).on(
    "alert:broadcast",
    (alert: Alert) => {
      if (!alert.channels.includes("telegram")) return;
      broadcastAlert(bot, alert);
    },
  );

  return socket;
}

async function broadcastAlert(bot: TelegramBot, alert: Alert): Promise<void> {
  const emoji = URGENCY_EMOJI[alert.urgency] ?? "📢";
  const label = ALERT_URGENCY_LABELS[alert.urgency] ?? alert.urgency;
  const isCritical = alert.urgency === "critical";

  const text =
    `${emoji} *${alert.title}* [${label}]\n\n` +
    `${alert.body}` +
    (alert.expiresAt
      ? `\n\n⏰ Действует до: ${new Date(alert.expiresAt).toLocaleString("ru-RU")}`
      : "");

  const subscribers = await getSubscribers();
  const failedChats: number[] = [];

  for (const chatId of subscribers) {
    try {
      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        disable_notification: !isCritical,
      });
    } catch (err) {
      const error = err as { response?: { statusCode?: number } };
      if (
        error.response?.statusCode === 403 ||
        error.response?.statusCode === 400
      ) {
        failedChats.push(chatId);
      }
    }
  }

  if (failedChats.length > 0) {
    await redis.srem(SUBSCRIBERS_KEY, ...failedChats.map(String));
  }

  console.log(
    `Broadcast alert "${alert.title}" to ${subscribers.length} chats ` +
      `(${failedChats.length} removed)`,
  );
}
