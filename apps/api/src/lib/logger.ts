// SPDX-License-Identifier: AGPL-3.0-only
import pino from "pino";
import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino/file", options: { destination: 1 } }
      : undefined,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      log?: pino.Logger;
    }
  }
}

/**
 * Structured request logging middleware with request ID tracing.
 * Replaces the simple requestLogger middleware.
 */
export function pinoRequestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers["x-request-id"] as string) ?? randomUUID();
  req.requestId = requestId;
  req.log = logger.child({ requestId });

  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      userId: req.user?.sub,
    };

    if (res.statusCode >= 500) {
      req.log!.error(logData, "request error");
    } else if (res.statusCode >= 400) {
      req.log!.warn(logData, "request warning");
    } else {
      req.log!.info(logData, "request completed");
    }
  });

  res.setHeader("X-Request-Id", requestId);
  next();
}
