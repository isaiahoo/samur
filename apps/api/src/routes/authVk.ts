// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "@samur/db";
import { config } from "../config.js";
import { AppError } from "../middleware/error.js";
import { logger } from "../lib/logger.js";

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

function signToken(userId: string, role: string): string {
  return jwt.sign(
    { sub: userId, role },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN } as jwt.SignOptions,
  );
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

    const token = signToken(user.id, user.role);

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
