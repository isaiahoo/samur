// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Test helper: creates an Express app with all routes but no server.listen().
 * Tests use supertest against this app instance.
 *
 * NOTE: These tests require a running PostgreSQL with PostGIS.
 * Use docker-compose up postgres before running tests.
 */
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { prisma } from "@samur/db";
import { optionalAuth } from "../src/middleware/auth.js";
import { initRateLimiter, rateLimiterMiddleware } from "../src/middleware/rateLimiter.js";
import { notFoundHandler, errorHandler } from "../src/middleware/error.js";

import healthRouter from "../src/routes/health.js";
import authRouter from "../src/routes/auth.js";
import incidentsRouter from "../src/routes/incidents.js";
import helpRequestsRouter from "../src/routes/helpRequests.js";
import alertsRouter from "../src/routes/alerts.js";
import sheltersRouter from "../src/routes/shelters.js";
import riverLevelsRouter from "../src/routes/riverLevels.js";
import webhooksRouter from "../src/routes/webhooks.js";
import channelsRouter from "../src/routes/channels.js";
import uploadsRouter from "../src/routes/uploads.js";
import moderationRouter from "../src/routes/moderation.js";
import adminRouter from "../src/routes/admin.js";

export function createTestApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));
  app.use(optionalAuth);

  app.use("/api/v1", healthRouter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/incidents", incidentsRouter);
  app.use("/api/v1/help-requests", helpRequestsRouter);
  app.use("/api/v1/alerts", alertsRouter);
  app.use("/api/v1/shelters", sheltersRouter);
  app.use("/api/v1/river-levels", riverLevelsRouter);
  app.use("/api/v1/webhook", webhooksRouter);
  app.use("/api/v1/channels", channelsRouter);
  app.use("/api/v1/uploads", uploadsRouter);
  app.use("/api/v1/moderation", moderationRouter);
  app.use("/api/v1/admin", adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/** Variant of createTestApp that initializes the rate limiter with an
 * in-memory store (no Redis dependency) AND mounts the global
 * rateLimiterMiddleware before routes. Used exclusively by the rate-
 * limiter test file — the default createTestApp skips this so
 * functional tests don't trip on per-endpoint caps mid-run. */
export function createRateLimitTestApp() {
  initRateLimiter(null);
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));
  app.use(optionalAuth);
  app.use(rateLimiterMiddleware);

  app.use("/api/v1", healthRouter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/incidents", incidentsRouter);
  app.use("/api/v1/help-requests", helpRequestsRouter);
  app.use("/api/v1/alerts", alertsRouter);
  app.use("/api/v1/shelters", sheltersRouter);
  app.use("/api/v1/river-levels", riverLevelsRouter);
  app.use("/api/v1/webhook", webhooksRouter);
  app.use("/api/v1/channels", channelsRouter);
  app.use("/api/v1/uploads", uploadsRouter);
  app.use("/api/v1/moderation", moderationRouter);
  app.use("/api/v1/admin", adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

const JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-min-16-chars!!";

/** Sign a JWT. `tokenVersion` is optional — when omitted the token
 * carries no version field, which the middleware interprets as 0
 * (the backwards-compat path for legacy tokens). Pass an explicit
 * number to simulate a specific version for revocation tests. */
export function makeToken(
  userId: string,
  role: string = "resident",
  tokenVersion?: number,
): string {
  const payload: { sub: string; role: string; tokenVersion?: number } = {
    sub: userId,
    role,
  };
  if (tokenVersion !== undefined) payload.tokenVersion = tokenVersion;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "1h", algorithm: "HS256" });
}

export function makeCoordinatorToken(userId: string): string {
  return makeToken(userId, "coordinator");
}

/** Convenience: create a user + return { id, token } in one call. The
 * token is always signed at the user's current tokenVersion (default
 * 0), so downstream auth checks pass. */
export async function makeUser(opts: {
  role?: "resident" | "volunteer" | "coordinator" | "admin";
  phone?: string;
  name?: string;
} = {}): Promise<{ id: string; token: string; role: string }> {
  const role = opts.role ?? "resident";
  const user = await prisma.user.create({
    data: {
      name: opts.name ?? `Test ${Math.random().toString(36).slice(2, 8)}`,
      phone: opts.phone ?? `+7999${Math.floor(1000000 + Math.random() * 8999999)}`,
      role,
      password: "test-hash",
    },
  });
  return {
    id: user.id,
    token: makeToken(user.id, role, user.tokenVersion),
    role,
  };
}
