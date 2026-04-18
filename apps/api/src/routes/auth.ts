// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import bcrypt from "bcrypt";
import { prisma } from "@samur/db";
import { validateBody } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { authAttemptsRateLimiter } from "../middleware/rateLimiter.js";
import { LoginSchema, RegisterSchema } from "@samur/shared";
import { AppError } from "../middleware/error.js";
import { signToken } from "../lib/jwt.js";
import { incrementTokenVersion } from "../lib/tokenVersion.js";
import { getRedis } from "../lib/redis.js";
import { disconnectUserSockets } from "../socket.js";
import { auditLog } from "../lib/auditLog.js";

const router = Router();
/** bcrypt cost factor for new account hashes. 12 is ~4× the work of
 * 10 on the same hardware, still well under the 250 ms ceiling for an
 * authenticated request. Existing users keep their 10-round hashes —
 * no forced re-hash; on next successful login we could transparently
 * re-hash at the higher cost, but that's a follow-up. */
const SALT_ROUNDS = 12;

function sanitizeUser(user: { id: string; name: string | null; phone: string | null; role: string; vkId: string | null; tgId: string | null; createdAt: Date; updatedAt: Date }) {
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

router.post(
  "/register",
  validateBody(RegisterSchema),
  authAttemptsRateLimiter,
  async (req, res, next) => {
    try {
      const { name, phone, password } = req.body;

      const existing = await prisma.user.findUnique({ where: { phone } });
      if (existing) {
        throw new AppError(409, "PHONE_EXISTS", "Пользователь с таким номером уже зарегистрирован");
      }

      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

      const user = await prisma.user.create({
        data: {
          name,
          phone,
          password: hashedPassword,
          role: "resident",
        },
      });

      const token = signToken(user.id, user.role, user.tokenVersion);

      res.status(201).json({
        success: true,
        data: { token, user: sanitizeUser(user) },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/login",
  validateBody(LoginSchema),
  authAttemptsRateLimiter,
  async (req, res, next) => {
    try {
      const { phone, password } = req.body;

      const user = await prisma.user.findUnique({ where: { phone } });
      if (!user || !user.password) {
        throw new AppError(401, "INVALID_CREDENTIALS", "Неверный номер телефона или пароль");
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        throw new AppError(401, "INVALID_CREDENTIALS", "Неверный номер телефона или пароль");
      }

      const token = signToken(user.id, user.role, user.tokenVersion);

      res.json({
        success: true,
        data: { token, user: sanitizeUser(user) },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.sub },
    });
    if (!user) {
      throw new AppError(404, "USER_NOT_FOUND", "Пользователь не найден");
    }

    // If the JWT carries a stale role (happens when the role was changed in
    // a version that didn't reissue the token), hand back a fresh token so
    // the client can swap it in without forcing a re-login.
    const token = user.role !== req.user!.role
      ? signToken(user.id, user.role, user.tokenVersion)
      : undefined;

    res.json({ success: true, data: sanitizeUser(user), token });
  } catch (err) {
    next(err);
  }
});

router.patch("/me", requireAuth, async (req, res, next) => {
  try {
    const { name, role } = req.body as { name?: string; role?: string };

    const data: Record<string, string> = {};
    if (name && typeof name === "string" && name.trim().length > 0 && name.length <= 200) {
      data.name = name.trim();
    }
    if (role && ["resident", "volunteer"].includes(role)) {
      data.role = role;
    }

    if (Object.keys(data).length === 0) {
      throw new AppError(400, "NO_CHANGES", "Нет данных для обновления");
    }

    const roleChanged = data.role !== undefined && data.role !== req.user!.role;

    // Role change: bump tokenVersion alongside the update so the OLD
    // JWT stops working the moment the response is served. Without
    // this, a demoted admin would keep their admin rights until their
    // 7-day token expired. Combined with the new middleware version
    // check, the bump invalidates every outstanding token the caller
    // has (across every device they're signed in on).
    const user = await prisma.user.update({
      where: { id: req.user!.sub },
      data: roleChanged ? { ...data, tokenVersion: { increment: 1 } } : data,
    });

    // Overwrite the cache with the post-increment value (rather than
    // just deleting), matching the pattern in incrementTokenVersion —
    // this closes the stale-write race where an in-flight read on
    // another node could re-prime a cleared cache with the pre-bump
    // version. Also kill any open sockets the user has; their old
    // token is now invalid.
    if (roleChanged) {
      const redis = getRedis();
      if (redis) {
        try {
          await redis.set(`tv:${user.id}`, String(user.tokenVersion), "EX", 30);
        } catch { /* ignore */ }
      }
      disconnectUserSockets(user.id);
    }

    // Mint a fresh token on role change so the client can swap it and
    // keep operating — otherwise the next request hits the new version
    // mismatch and 401s.
    const token = roleChanged
      ? signToken(user.id, user.role, user.tokenVersion)
      : undefined;

    res.json({ success: true, data: sanitizeUser(user), token });
  } catch (err) {
    next(err);
  }
});

/** POST /auth/logout-all
 *
 * Bumps the caller's tokenVersion, invalidating every JWT for this user
 * across every device. The caller's current token stops working as soon
 * as the next request lands — they'll need to sign in again. Used by the
 * "log out everywhere" flow and as the primitive for the future admin
 * force-logout endpoint.
 */
router.post("/logout-all", requireAuth, async (req, res, next) => {
  try {
    const newVersion = await incrementTokenVersion(req.user!.sub);
    // Tear down any open sockets too — the HTTP revocation alone
    // would leave realtime channels (chat, help-request events) open
    // on the already-sent tokens until the socket naturally closed.
    disconnectUserSockets(req.user!.sub);
    auditLog({ action: "logout_all", actorId: req.user!.sub });
    res.json({ success: true, data: { tokenVersion: newVersion } });
  } catch (err) {
    next(err);
  }
});

export default router;
