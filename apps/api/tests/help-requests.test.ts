// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { prisma } from "@samur/db";
import { createTestApp, makeToken } from "./setup.js";

const app = createTestApp();

let userId: string;
let token: string;
let helpRequestId: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      name: "Help Test User",
      phone: "+79990000003",
      role: "volunteer",
      password: "hashed",
    },
  });
  userId = user.id;
  token = makeToken(userId, "volunteer");
});

describe("Help Requests CRUD", () => {
  it("POST /api/v1/help-requests — creates need request", async () => {
    const res = await request(app)
      .post("/api/v1/help-requests")
      .set("Authorization", `Bearer ${token}`)
      .send({
        type: "need",
        category: "food",
        lat: 42.98,
        lng: 47.50,
        description: "Need food for 10 people",
        urgency: "urgent",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe("need");
    expect(res.body.data.category).toBe("food");
    expect(res.body.data.status).toBe("open");
    helpRequestId = res.body.data.id;
  });

  it("POST /api/v1/help-requests — creates offer", async () => {
    const res = await request(app)
      .post("/api/v1/help-requests")
      .set("Authorization", `Bearer ${token}`)
      .send({
        type: "offer",
        category: "transport",
        lat: 42.97,
        lng: 47.49,
        description: "Have a truck available",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe("offer");
  });

  it("GET /api/v1/help-requests — lists requests", async () => {
    const res = await request(app).get("/api/v1/help-requests");

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it("GET /api/v1/help-requests — filters by category", async () => {
    const res = await request(app).get("/api/v1/help-requests?category=food");

    expect(res.status).toBe(200);
    for (const hr of res.body.data) {
      expect(hr.category).toBe("food");
    }
  });

  it("GET /api/v1/help-requests — filters by type", async () => {
    const res = await request(app).get("/api/v1/help-requests?type=need");

    expect(res.status).toBe(200);
    for (const hr of res.body.data) {
      expect(hr.type).toBe("need");
    }
  });

  it("POST /api/v1/help-requests/:id/claim — claims request", async () => {
    const res = await request(app)
      .post(`/api/v1/help-requests/${helpRequestId}/claim`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("claimed");
    expect(res.body.data.claimedBy).toBe(userId);
  });

  it("POST /api/v1/help-requests — validates required fields", async () => {
    const res = await request(app)
      .post("/api/v1/help-requests")
      .set("Authorization", `Bearer ${token}`)
      .send({
        type: "need",
        // missing category, lat, lng
      });

    expect(res.status).toBe(400);
  });
});
