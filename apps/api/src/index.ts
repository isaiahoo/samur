// SPDX-License-Identifier: AGPL-3.0-only
import http from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { Redis } from "ioredis";

import { config } from "./config.js";
import { optionalAuth } from "./middleware/auth.js";
import { initRateLimiter, rateLimiterMiddleware } from "./middleware/rateLimiter.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { notFoundHandler, errorHandler } from "./middleware/error.js";
import { initSocketIO } from "./socket.js";

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
    console.error("Redis error:", err.message);
  });

  redisClient.on("connect", () => {
    console.log("Redis connected");
  });
} catch (err) {
  console.warn("Redis connection failed, running without Redis:", err);
  redisClient = null;
}

const corsOrigins = config.CORS_ORIGINS.split(",").map((s) => s.trim());

app.use(helmet());
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: "5mb" }));

// Parse JWT early so rate limiter can use role-based limits
app.use(optionalAuth);

app.use(requestLogger);

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

app.use(notFoundHandler);
app.use(errorHandler);

initSocketIO(server, corsOrigins, redisClient);

server.listen(config.PORT, () => {
  console.log(`🚀 Samur API running on port ${config.PORT} [${config.NODE_ENV}]`);
  console.log(`   Health:  http://localhost:${config.PORT}/api/v1/health`);
  console.log(`   Stats:   http://localhost:${config.PORT}/api/v1/stats`);
  console.log(`   Map:     http://localhost:${config.PORT}/api/v1/map/clusters`);
});

function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down...`);
  server.close(() => {
    redisClient?.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
