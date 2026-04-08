// SPDX-License-Identifier: AGPL-3.0-only
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";
import type { Request, Response, NextFunction } from "express";

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

// ── Custom metrics ─────────────────────────────────────────────────────────

export const httpRequestsTotal = new Counter({
  name: "samur_http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: "samur_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const wsConnectionsGauge = new Gauge({
  name: "samur_ws_connections_active",
  help: "Active WebSocket connections",
  registers: [registry],
});

export const incidentsCreatedTotal = new Counter({
  name: "samur_incidents_created_total",
  help: "Total incidents created",
  labelNames: ["source", "type"] as const,
  registers: [registry],
});

export const helpRequestsCreatedTotal = new Counter({
  name: "samur_help_requests_created_total",
  help: "Total help requests created",
  labelNames: ["source", "type"] as const,
  registers: [registry],
});

// ── Middleware ──────────────────────────────────────────────────────────────

function normalizeRoute(req: Request): string {
  // Collapse dynamic IDs to :id for metric grouping
  const route = req.route?.path ?? req.path;
  return route.replace(/\/[a-z0-9]{20,}/gi, "/:id");
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationS = durationNs / 1e9;
    const route = normalizeRoute(req);
    const labels = { method: req.method, route, status: String(res.statusCode) };

    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, durationS);
  });

  next();
}
