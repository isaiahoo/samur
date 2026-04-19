// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "@samur/db";
import { config } from "../config.js";
import { validateBody } from "../middleware/validate.js";
import { TelegramAuthSchema } from "@samur/shared";
import { AppError } from "../middleware/error.js";
import { logger } from "../lib/logger.js";
import { getRedis } from "../lib/redis.js";
import { signToken } from "../lib/jwt.js";
import { authAttemptsTotal } from "../lib/metrics.js";
import { recordConsentOnRegister } from "../lib/recordConsentOnRegister.js";
import type { ConsentInput } from "@samur/shared";

const router = Router();

/**
 * Verify Telegram Login Widget data using HMAC-SHA256.
 * https://core.telegram.org/widgets/login#checking-authorization
 */
function verifyTelegramAuth(
  data: Record<string, string | number>,
  botToken: string,
): boolean {
  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const checkString = Object.keys(data)
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("\n");
  const hmac = crypto
    .createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  return hmac === String(data.hash);
}

function sanitizeUser(user: {
  id: string;
  name: string | null;
  phone: string | null;
  role: string;
  vkId: string | null;
  tgId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role,
    vkId: user.vkId,
    tgId: user.tgId,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

/**
 * POST /api/v1/auth/telegram
 * Body: { id, first_name, last_name?, username?, photo_url?, auth_date, hash }
 *
 * Verifies Telegram Login Widget HMAC, finds or creates user, returns JWT.
 */
router.post(
  "/telegram",
  validateBody(TelegramAuthSchema),
  async (req, res, next) => {
    try {
      const data = req.body as Record<string, string | number>;

      // Verify HMAC signature
      if (!config.TG_BOT_TOKEN) {
        throw new AppError(
          500,
          "TG_NOT_CONFIGURED",
          "TG_BOT_TOKEN не настроен",
        );
      }

      if (!verifyTelegramAuth(data, config.TG_BOT_TOKEN)) {
        throw new AppError(
          403,
          "INVALID_SIGNATURE",
          "Неверная подпись Telegram",
        );
      }

      // Reject stale auth (older than 24 hours)
      const authDate = Number(data.auth_date);
      if (Date.now() / 1000 - authDate > 86400) {
        throw new AppError(
          401,
          "AUTH_EXPIRED",
          "Данные авторизации устарели. Попробуйте снова.",
        );
      }

      const tgId = String(data.id);
      const firstName = String(data.first_name);
      const lastName = data.last_name ? String(data.last_name) : null;
      const fullName = lastName ? `${firstName} ${lastName}` : firstName;

      // Find existing user by tgId
      let user = await prisma.user.findFirst({
        where: { tgId },
      });

      if (user) {
        // Update name if changed
        if (user.name !== fullName) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { name: fullName },
          });
        }
      } else {
        // Auto-register Telegram user. The bot stitched consent into
        // the request body before HMAC-signing it (see apps/telegram
        // /src/api.ts authenticateForPWA), or the PWA passed it in
        // directly for the Login Widget flow.
        const consent = (req.body as { consent?: ConsentInput }).consent;
        const created = await prisma.$transaction(async (tx) => {
          const newUser = await tx.user.create({
            data: {
              tgId,
              name: fullName,
              role: "resident",
            },
          });
          await recordConsentOnRegister(req, newUser.id, consent, tx as typeof prisma);
          return newUser;
        });
        user = created;
        logger.info({ tgId, name: fullName }, "New user registered via Telegram");
      }

      const token = signToken(user.id, user.role, user.tokenVersion);
      authAttemptsTotal.inc({ flow: "telegram", outcome: "success" });

      res.json({
        success: true,
        data: { token, user: sanitizeUser(user) },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/v1/auth/telegram/init
 *
 * Generates a unique auth token for Telegram deep link login.
 * The PWA opens tg://resolve?domain=BOT&start=login_TOKEN
 * and then polls /telegram/check until the bot confirms auth.
 */
router.post("/telegram/init", async (req, res, next) => {
  try {
    const redis = getRedis();
    if (!redis) {
      throw new AppError(503, "REDIS_UNAVAILABLE", "Сервис временно недоступен");
    }

    const consent = (req.body as { consent?: ConsentInput })?.consent;
    const token = crypto.randomBytes(24).toString("hex"); // 48 chars
    // Pending value carries the consent payload so the bot can read it
    // when handling the deep link and forward it to /auth/telegram.
    // Older bots that pre-date this field will get undefined and the
    // user-create path will reject with 400 — acceptable since both bot
    // and api deploy together.
    const pending = JSON.stringify({ status: "pending", consent: consent ?? null });
    await redis.set(`tg_auth:${token}`, pending, "EX", 300);

    res.json({ success: true, data: { token } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/auth/telegram/check?token=TOKEN
 *
 * Polls for Telegram deep link auth completion.
 * Returns { status: "pending" } or { status: "ok", token, user }.
 */
router.get("/telegram/check", async (req, res, next) => {
  try {
    const { token } = req.query as { token?: string };
    if (!token) {
      throw new AppError(400, "MISSING_TOKEN", "token обязателен");
    }
    if (token.length > 96) {
      // Legitimate tokens are 48 hex — reject longer inputs cheaply
      // before they can touch Redis.
      throw new AppError(400, "INVALID_TOKEN", "Некорректный токен");
    }

    const redis = getRedis();
    if (!redis) {
      throw new AppError(503, "REDIS_UNAVAILABLE", "Сервис временно недоступен");
    }

    // Poll-rate cap: at most 30 checks per token per minute. Legit
    // client polls every ~2 s for 5 min = 150 checks, so a per-minute
    // cap at 30 covers the legitimate pattern while bounding the
    // damage of a rogue client hammering the endpoint (budget burn
    // for other callers sharing the IP-level global limit).
    const pollKey = `tg_auth_poll:${token}`;
    const polls = await redis.incr(pollKey);
    if (polls === 1) {
      // First poll — set the window TTL.
      await redis.expire(pollKey, 60);
    }
    if (polls > 30) {
      throw new AppError(429, "POLL_RATE_LIMIT", "Слишком частые запросы проверки.");
    }

    const value = await redis.get(`tg_auth:${token}`);

    if (!value) {
      throw new AppError(404, "TOKEN_EXPIRED", "Токен истёк или не найден");
    }

    // /init now stores JSON { status: "pending", consent }; the bot
    // overwrites with { status: "ok" | "jwt", jwt, user } once auth
    // completes. Keep the legacy literal "pending" check for any
    // tokens written before this rollout that may still be in flight.
    if (value === "pending") {
      res.json({ success: true, data: { status: "pending" } });
      return;
    }

    let parsed: { status?: string; jwt?: string; user?: unknown };
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new AppError(500, "INVALID_AUTH_DATA", "Ошибка данных авторизации");
    }

    if (parsed.status === "pending") {
      res.json({ success: true, data: { status: "pending" } });
      return;
    }

    if (parsed.jwt && parsed.user) {
      await redis.del(`tg_auth:${token}`);
      res.json({ success: true, data: { status: "ok", token: parsed.jwt, user: parsed.user } });
      return;
    }

    throw new AppError(500, "INVALID_AUTH_DATA", "Ошибка данных авторизации");
  } catch (err) {
    next(err);
  }
});

export default router;
