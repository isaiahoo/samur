// SPDX-License-Identifier: AGPL-3.0-only
import http from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { Redis } from "ioredis";

import { config } from "./config.js";
import { optionalAuth } from "./middleware/auth.js";
import { initRateLimiter, rateLimiterMiddleware } from "./middleware/rateLimiter.js";
import { pinoRequestLogger, logger } from "./lib/logger.js";
import { metricsMiddleware } from "./lib/metrics.js";
import { notFoundHandler, errorHandler } from "./middleware/error.js";
import { initSocketIO } from "./socket.js";
import { startScheduler, stopScheduler } from "./services/scheduler.js";

import healthRouter from "./routes/health.js";
import authRouter from "./routes/auth.js";
import authVkRouter from "./routes/authVk.js";
import incidentsRouter from "./routes/incidents.js";
import helpRequestsRouter from "./routes/helpRequests.js";
import alertsRouter from "./routes/alerts.js";
import sheltersRouter from "./routes/shelters.js";
import riverLevelsRouter from "./routes/riverLevels.js";
import mapRouter from "./routes/map.js";
import statsRouter from "./routes/stats.js";
import webhooksRouter from "./routes/webhooks.js";
import channelsRouter from "./routes/channels.js";
import newsRouter from "./routes/news.js";
import weatherRouter from "./routes/weather.js";
import tilesRouter from "./routes/tiles.js";
import metricsRouter from "./routes/metrics.js";

const app = express();
const server = http.createServer(app);

let redisClient: Redis | null = null;

try {
  redisClient = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) return null;
      return Math.min(times * 200, 2000);
    },
  });

  redisClient.on("error", (err) => {
    logger.error({ err: err.message }, "Redis error");
  });

  redisClient.on("connect", () => {
    logger.info("Redis connected");
  });
} catch (err) {
  logger.warn({ err }, "Redis connection failed, running without Redis");
  redisClient = null;
}

const corsOrigins = config.CORS_ORIGINS.split(",").map((s) => s.trim());

// ── Tile proxy: mounted BEFORE heavy middleware (no auth/rate-limit/logging) ──
app.use("/api/v1/tiles", cors({ origin: corsOrigins }), tilesRouter);

app.use(helmet());
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: "5mb" }));

// Parse JWT early so rate limiter can use role-based limits
app.use(optionalAuth);

app.use(pinoRequestLogger);
app.use(metricsMiddleware);

// Rate limiter (role-aware: 30/min anon, 120/min auth, 600/min coordinator)
initRateLimiter(redisClient);
app.use(rateLimiterMiddleware);

app.use("/api/v1", healthRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/auth", authVkRouter);
app.use("/api/v1/incidents", incidentsRouter);
app.use("/api/v1/help-requests", helpRequestsRouter);
app.use("/api/v1/alerts", alertsRouter);
app.use("/api/v1/shelters", sheltersRouter);
app.use("/api/v1/river-levels", riverLevelsRouter);
app.use("/api/v1/map", mapRouter);
app.use("/api/v1/stats", statsRouter);
app.use("/api/v1/webhook", webhooksRouter);
app.use("/api/v1/channels", channelsRouter);
app.use("/api/v1/news", newsRouter);
app.use("/api/v1/weather", weatherRouter);
app.use(metricsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

initSocketIO(server, corsOrigins, redisClient);

server.listen(config.PORT, () => {
  logger.info({
    port: config.PORT,
    env: config.NODE_ENV,
  }, "Samur API running");

  // Start river level scraping scheduler
  startScheduler().catch((err) => {
    logger.error({ err }, "Failed to start river scraper scheduler");
  });
});

function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down...");
  stopScheduler();
  server.close(() => {
    redisClient?.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
