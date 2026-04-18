// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "@samur/db";
import { config } from "../config.js";
import { AppError } from "../middleware/error.js";
import { logger } from "../lib/logger.js";
import { signToken } from "../lib/jwt.js";

const router = Router();

/**
 * Verify VK launch params signature.
 * See: https://dev.vk.com/mini-apps/development/launch-params-sign
 */
function verifyVkLaunchParams(
  searchParams: string,
  secretKey: string,
): { valid: boolean; vkUserId: string | null } {
  const params = new URLSearchParams(searchParams);

  // Extract vk_* params, sort alphabetically
  const vkParams: [string, string][] = [];
  for (const [key, value] of params) {
    if (key.startsWith("vk_")) {
      vkParams.push([key, value]);
    }
  }
  vkParams.sort(([a], [b]) => a.localeCompare(b));

  const queryString = new URLSearchParams(vkParams).toString();
  const sign = params.get("sign");

  if (!sign) return { valid: false, vkUserId: null };

  const hmac = crypto
    .createHmac("sha256", secretKey)
    .update(queryString)
    .digest()
    .toString("base64url");

  return {
    valid: hmac === sign,
    vkUserId: params.get("vk_user_id"),
  };
}

/**
 * POST /api/v1/auth/vk
 * Body: { launchParams: string, name?: string }
 *
 * Verifies VK launch params signature, finds or creates user, returns JWT.
 */
router.post("/vk", async (req, res, next) => {
  try {
    const { launchParams, name } = req.body as {
      launchParams: string;
      name?: string;
    };

    if (!launchParams || typeof launchParams !== "string") {
      throw new AppError(400, "INVALID_PARAMS", "launchParams обязателен");
    }

    let vkUserId: string | null = null;

    if (config.VK_SECRET) {
      const result = verifyVkLaunchParams(launchParams, config.VK_SECRET);
      if (!result.valid) {
        throw new AppError(403, "INVALID_SIGNATURE", "Неверная подпись VK");
      }
      vkUserId = result.vkUserId;
    } else if (config.NODE_ENV === "development") {
      // Dev mode only: extract vk_user_id without verification
      logger.warn("VK auth: signature verification skipped (dev mode, VK_SECRET not set)");
      const params = new URLSearchParams(launchParams);
      vkUserId = params.get("vk_user_id");
    } else {
      throw new AppError(500, "VK_NOT_CONFIGURED", "VK_SECRET обязателен в production");
    }

    if (!vkUserId) {
      throw new AppError(400, "MISSING_VK_USER_ID", "vk_user_id не найден");
    }

    // Find existing user by vkId
    let user = await prisma.user.findFirst({
      where: { vkId: vkUserId },
    });

    if (!user) {
      // Auto-register VK user
      user = await prisma.user.create({
        data: {
          vkId: vkUserId,
          name: name ?? `VK User ${vkUserId}`,
          role: "resident",
        },
      });
    }

    const token = signToken(user.id, user.role, user.tokenVersion);

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          role: user.role,
          vkId: user.vkId,
          tgId: user.tgId,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/auth/vk/exchange
 * Body: { code, codeVerifier, redirectUri, deviceId }
 *
 * VK ID OAuth 2.0 Authorization Code + PKCE exchange.
 * Exchanges auth code for access_token (server-to-server),
 * fetches user info, finds or creates user, returns JWT.
 */
router.post("/vk/exchange", async (req, res, next) => {
  try {
    const { code, codeVerifier, redirectUri, deviceId } = req.body as {
      code: string;
      codeVerifier: string;
      redirectUri: string;
      deviceId?: string;
    };

    if (!code || !codeVerifier || !redirectUri) {
      throw new AppError(400, "INVALID_PARAMS", "code, codeVerifier и redirectUri обязательны");
    }

    if (!config.VK_APP_ID || !config.VK_SECRET) {
      throw new AppError(500, "VK_NOT_CONFIGURED", "VK_APP_ID и VK_SECRET должны быть настроены");
    }

    // Step 1: Exchange code for access_token
    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      client_id: config.VK_APP_ID,
      redirect_uri: redirectUri,
    });
    if (deviceId) tokenParams.set("device_id", deviceId);

    const tokenRes = await fetch("https://id.vk.com/oauth2/auth", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    });

    const tokenData = await tokenRes.json() as {
      access_token?: string;
      user_id?: number;
      error?: string;
      error_description?: string;
    };

    if (!tokenData.access_token) {
      logger.warn({ error: tokenData.error, desc: tokenData.error_description }, "VK token exchange failed");
      throw new AppError(401, "VK_AUTH_FAILED", tokenData.error_description ?? "Ошибка авторизации VK");
    }

    // Step 2: Fetch user info from VK
    const userInfoRes = await fetch("https://id.vk.com/oauth2/user_info", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access_token: tokenData.access_token,
        client_id: config.VK_APP_ID,
      }).toString(),
    });

    const userInfo = await userInfoRes.json() as {
      user: {
        user_id: string;
        first_name: string;
        last_name: string;
        phone?: string;
        email?: string;
        avatar?: string;
        verified?: boolean;
      };
      error?: string;
    };

    if (!userInfo.user?.user_id) {
      logger.warn({ error: userInfo.error }, "VK user info fetch failed");
      throw new AppError(401, "VK_USER_FETCH_FAILED", "Не удалось получить данные пользователя VK");
    }

    const vkUser = userInfo.user;
    const vkId = String(vkUser.user_id);
    const fullName = [vkUser.first_name, vkUser.last_name].filter(Boolean).join(" ") || `VK User ${vkId}`;
    const vkPhone = vkUser.phone || null;

    // Step 3: Find or create user
    let user = await prisma.user.findFirst({ where: { vkId } });

    if (user) {
      // Update name and phone if needed
      const updates: Record<string, string> = {};
      if (user.name !== fullName) updates.name = fullName;
      if (vkPhone && !user.phone) updates.phone = vkPhone;

      if (Object.keys(updates).length > 0) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: updates,
        });
      }
    } else {
      // Check if a user with this VK phone already exists — link accounts
      if (vkPhone) {
        user = await prisma.user.findFirst({ where: { phone: vkPhone } });
        if (user) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { vkId, name: user.name || fullName },
          });
          logger.info({ vkId, userId: user.id }, "Linked VK account to existing user by phone");
        }
      }

      if (!user) {
        user = await prisma.user.create({
          data: {
            vkId,
            name: fullName,
            phone: vkPhone,
            role: "resident",
          },
        });
        logger.info({ vkId, name: fullName }, "New user registered via VK ID");
      }
    }

    const token = signToken(user.id, user.role, user.tokenVersion);

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          role: user.role,
          vkId: user.vkId,
          tgId: user.tgId,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
