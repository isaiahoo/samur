// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createTestApp } from "./setup.js";

const app = createTestApp();

describe("GET /api/v1/health", () => {
  it("returns health status", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toMatch(/healthy|degraded/);
    expect(res.body.data.uptime).toBeDefined();
    expect(res.body.data.database).toBeDefined();
  });
});

describe("GET /nonexistent", () => {
  it("returns 404", async () => {
    const res = await request(app).get("/nonexistent");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
