// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "@samur/db";
import { config } from "../config.js";
import { validateBody } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { LoginSchema, RegisterSchema } from "@samur/shared";
import type { JwtPayload } from "@samur/shared";
import { AppError } from "../middleware/error.js";

const router = Router();
const SALT_ROUNDS = 10;

function signToken(userId: string, role: string): string {
  return jwt.sign(
    { sub: userId, role },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN } as jwt.SignOptions
  );
}

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

      const token = signToken(user.id, user.role);

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

      const token = signToken(user.id, user.role);

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
    const token = user.role !== req.user!.role ? signToken(user.id, user.role) : undefined;

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

    const user = await prisma.user.update({
      where: { id: req.user!.sub },
      data,
    });

    // If role changed, the caller's JWT is stale — mint a new one so their
    // next authorised request (e.g. claiming a help request as a volunteer)
    // passes the role gate instead of being denied on an old "resident" claim.
    const roleChanged = data.role !== undefined && data.role !== req.user!.role;
    const token = roleChanged ? signToken(user.id, user.role) : undefined;

    res.json({ success: true, data: sanitizeUser(user), token });
  } catch (err) {
    next(err);
  }
});

export default router;
