// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createTestApp } from "./setup.js";

const app = createTestApp();

describe("GET /api/v1/channels/health", () => {
  it("returns health status for all channels", async () => {
    const res = await request(app).get("/api/v1/channels/health");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(data.pwa).toBe("online");
    expect(data.vk).toBe("online");
    expect(["online", "degraded", "offline"]).toContain(data.telegram);
    expect(["online", "offline"]).toContain(data.sms);
    expect(["online", "offline"]).toContain(data.meshtastic);
  });
});
