// SPDX-License-Identifier: AGPL-3.0-only
import type { Request, Response, NextFunction } from "express";

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const userId = req.user?.sub ?? "anon";
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";

    const logLine = JSON.stringify({
      level,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      userId,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });

    if (level === "error") {
      console.error(logLine);
    } else {
      console.log(logLine);
    }
  });

  next();
}
