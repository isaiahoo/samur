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
import { optionalAuth } from "../src/middleware/auth.js";
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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

const JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-min-16-chars!!";

export function makeToken(userId: string, role: string = "resident"): string {
  return jwt.sign({ sub: userId, role }, JWT_SECRET, { expiresIn: "1h" });
}

export function makeCoordinatorToken(userId: string): string {
  return makeToken(userId, "coordinator");
}
