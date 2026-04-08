// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import { prisma } from "@samur/db";
import { config } from "../config.js";
import type { ChannelHealth, ChannelStatus } from "@samur/shared";

const router = Router();

const HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * GET /channels/health
 * Returns status of each communication channel.
 */
router.get("/health", async (_req, res, next) => {
  try {
    const health: ChannelHealth = {
      pwa: "online", // PWA is always online if API is responding
      telegram: "offline",
      vk: "online", // VK Mini App is static, always online if API is up
      sms: "offline",
      meshtastic: "offline",
    };

    // ── Telegram: check via Bot API getMe ──
    if (config.TG_BOT_TOKEN) {
      try {
        const resp = await fetch(
          `https://api.telegram.org/bot${config.TG_BOT_TOKEN}/getMe`,
          { signal: AbortSignal.timeout(5000) }
        );
        const data = await resp.json() as { ok?: boolean };
        health.telegram = data.ok ? "online" : "degraded";
      } catch {
        health.telegram = "offline";
      }
    }

    // ── Meshtastic: check heartbeat timestamp ──
    try {
      const heartbeat = await prisma.channelHeartbeat.findUnique({
        where: { channel: "meshtastic" },
      });
      if (heartbeat) {
        const age = Date.now() - heartbeat.lastSeen.getTime();
        health.meshtastic = age <= HEARTBEAT_TIMEOUT_MS ? "online" : "offline";
      }
    } catch {
      // table might not exist yet
    }

    // ── SMS: check heartbeat timestamp (FrontlineSMS pings) ──
    try {
      const heartbeat = await prisma.channelHeartbeat.findUnique({
        where: { channel: "sms" },
      });
      if (heartbeat) {
        const age = Date.now() - heartbeat.lastSeen.getTime();
        health.sms = age <= HEARTBEAT_TIMEOUT_MS ? "online" : "offline";
      }
    } catch {
      // table might not exist yet
    }

    res.json({ success: true, data: health });
  } catch (err) {
    next(err);
  }
});

export default router;
