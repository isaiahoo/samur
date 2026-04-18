// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import { prisma } from "@samur/db";
import { config } from "../config.js";
import { validateBody } from "../middleware/validate.js";
import { PhoneRequestSchema, PhoneVerifySchema } from "@samur/shared";
import { AppError } from "../middleware/error.js";
import { logger } from "../lib/logger.js";
import { getRedis } from "../lib/redis.js";
import { signToken } from "../lib/jwt.js";
import { authAttemptsTotal } from "../lib/metrics.js";

const router = Router();

const CODE_TTL = 300; // 5 minutes
const COOLDOWN_TTL = 120; // 2 minutes between requests per phone
const MAX_ATTEMPTS = 3;

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
 * Normalize phone to digits-only format for GreenSMS (no + prefix).
 * "+79281234567" → "79281234567"
 * "89281234567"  → "79281234567" (replace leading 8 with 7 for Russia)
 */
function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  // Russian numbers: replace leading 8 with 7
  if (digits.length === 11 && digits.startsWith("8")) {
    digits = "7" + digits.slice(1);
  }
  // 10-digit number without country code — prepend 7 (Russia)
  if (digits.length === 10 && digits.startsWith("9")) {
    digits = "7" + digits;
  }
  return digits;
}

/**
 * POST /auth/phone/request
 * Initiates a flash call verification via GreenSMS.
 * The service calls the user's phone — last 4 digits of the calling number = code.
 */
router.post(
  "/phone/request",
  validateBody(PhoneRequestSchema),
  async (req, res, next) => {
    try {
      const { phone } = req.body;
      const digits = normalizePhone(phone);

      if (!config.GREENSMS_TOKEN) {
        throw new AppError(503, "SERVICE_UNAVAILABLE", "Верификация по звонку временно недоступна");
      }

      const redis = getRedis();
      if (!redis) {
        throw new AppError(503, "SERVICE_UNAVAILABLE", "Сервис временно недоступен");
      }

      // Rate limit: 1 request per phone per 2 minutes. The old error
      // surface included the exact remaining TTL — which let an
      // enumerator infer "phone X just requested OTP N seconds ago",
      // leaking account-activity timing. Now we return a generic
      // cooldown response without revealing how fresh the window is.
      const cooldownKey = `phone_cooldown:${digits}`;
      const cooldown = await redis.get(cooldownKey);
      if (cooldown) {
        throw new AppError(429, "RATE_LIMIT", "Подождите перед повторным запросом");
      }

      // Validate phone length (GreenSMS requires 11+ digits)
      if (digits.length < 11) {
        throw new AppError(400, "INVALID_PHONE", "Введите номер с кодом страны, например +79281234567");
      }

      // Call GreenSMS API (form-urlencoded, as per their SDK)
      const response = await fetch("https://api3.greensms.ru/call/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${config.GREENSMS_TOKEN}`,
        },
        body: `to=${digits}`,
      });

      const result = await response.json() as Record<string, unknown>;

      if (!response.ok || result.error) {
        logger.error({ status: response.status, result }, "GreenSMS call.send failed");
        throw new AppError(502, "CALL_FAILED", "Не удалось совершить звонок. Попробуйте позже.");
      }

      const code = String(result.code ?? "");
      if (!code || !/^\d{4,6}$/.test(code)) {
        logger.error({ result }, "GreenSMS response missing or invalid code");
        throw new AppError(502, "CALL_FAILED", "Ошибка сервиса верификации");
      }

      // Store code in Redis with TTL
      const codeKey = `phone_code:${digits}`;
      await redis.set(codeKey, JSON.stringify({ code, attempts: 0 }), "EX", CODE_TTL);

      // Set cooldown
      await redis.set(cooldownKey, "1", "EX", COOLDOWN_TTL);

      logger.info({ phone: digits }, "Phone verification call initiated");

      res.json({
        success: true,
        data: { method: "call", expiresIn: CODE_TTL },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /auth/phone/verify
 * Verifies the 4-digit code from the flash call.
 * If valid, finds or creates user by phone number, issues JWT.
 */
router.post(
  "/phone/verify",
  validateBody(PhoneVerifySchema),
  async (req, res, next) => {
    try {
      const { phone, code, name, role: requestedRole } = req.body;
      const digits = normalizePhone(phone);

      const redis = getRedis();
      if (!redis) {
        throw new AppError(503, "SERVICE_UNAVAILABLE", "Сервис временно недоступен");
      }

      const codeKey = `phone_code:${digits}`;
      const raw = await redis.get(codeKey);

      if (!raw) {
        throw new AppError(410, "CODE_EXPIRED", "Код истёк. Запросите новый звонок.");
      }

      const stored = JSON.parse(raw) as { code: string; attempts: number };

      // Check max attempts
      if (stored.attempts >= MAX_ATTEMPTS) {
        await redis.del(codeKey);
        throw new AppError(429, "MAX_ATTEMPTS", "Превышено количество попыток. Запросите новый звонок.");
      }

      // Increment attempts
      stored.attempts += 1;
      const ttl = await redis.ttl(codeKey);
      await redis.set(codeKey, JSON.stringify(stored), "EX", ttl > 0 ? ttl : CODE_TTL);

      if (stored.code !== code) {
        authAttemptsTotal.inc({ flow: "phone_verify", outcome: "invalid_code" });
        const remaining = MAX_ATTEMPTS - stored.attempts;
        throw new AppError(401, "INVALID_CODE", `Неверный код. Осталось попыток: ${remaining}`);
      }

      // Code is correct — delete it
      await redis.del(codeKey);

      // Find or create user by phone (always store as +7XXXXXXXXXX)
      const normalizedPhone = `+${digits}`;

      let user = await prisma.user.findFirst({
        where: {
          OR: [
            { phone: normalizedPhone },
            { phone: digits },
            { phone: `+${digits}` },
          ],
        },
      });

      let isNew = false;

      if (!user) {
        // New user — create account
        const validRoles = ["resident", "volunteer"];
        const role = validRoles.includes(requestedRole) ? requestedRole : "resident";
        user = await prisma.user.create({
          data: {
            name: name || "Пользователь",
            phone: normalizedPhone,
            role,
          },
        });
        isNew = true;
        logger.info({ userId: user.id, phone: normalizedPhone }, "New user created via phone verification");
      } else {
        // Existing user — update name if provided and user has no name
        if (name && !user.name) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { name },
          });
        }
        logger.info({ userId: user.id }, "Existing user logged in via phone verification");
      }

      const token = signToken(user.id, user.role, user.tokenVersion);
      authAttemptsTotal.inc({ flow: "phone_verify", outcome: "success" });

      res.json({
        success: true,
        data: { token, user: sanitizeUser(user), isNew },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
