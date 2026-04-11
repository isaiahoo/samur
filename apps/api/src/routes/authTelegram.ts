// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "@samur/db";
import { config } from "../config.js";
import { validateBody } from "../middleware/validate.js";
import { TelegramAuthSchema } from "@samur/shared";
import { AppError } from "../middleware/error.js";
import { logger } from "../lib/logger.js";

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

function signToken(userId: string, role: string): string {
  return jwt.sign(
    { sub: userId, role },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN } as jwt.SignOptions,
  );
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
        // Auto-register Telegram user
        user = await prisma.user.create({
          data: {
            tgId,
            name: fullName,
            role: "resident",
          },
        });
        logger.info({ tgId, name: fullName }, "New user registered via Telegram");
      }

      const token = signToken(user.id, user.role);

      res.json({
        success: true,
        data: { token, user: sanitizeUser(user) },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
