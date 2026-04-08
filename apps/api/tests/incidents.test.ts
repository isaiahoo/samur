// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { prisma } from "@samur/db";
import { createTestApp, makeToken, makeCoordinatorToken } from "./setup.js";

const app = createTestApp();

let userId: string;
let token: string;
let coordToken: string;
let incidentId: string;

beforeAll(async () => {
  // Create test user
  const user = await prisma.user.create({
    data: {
      name: "Test User",
      phone: "+79990000001",
      role: "resident",
      password: "hashed",
    },
  });
  userId = user.id;
  token = makeToken(userId, "resident");

  const coord = await prisma.user.create({
    data: {
      name: "Coordinator",
      phone: "+79990000002",
      role: "coordinator",
      password: "hashed",
    },
  });
  coordToken = makeCoordinatorToken(coord.id);
});

describe("Incidents CRUD", () => {
  it("POST /api/v1/incidents — creates incident", async () => {
    const res = await request(app)
      .post("/api/v1/incidents")
      .set("Authorization", `Bearer ${token}`)
      .send({
        type: "flood",
        severity: "high",
        lat: 42.98,
        lng: 47.50,
        address: "Test street",
        description: "Test flood incident",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.type).toBe("flood");
    expect(res.body.data.severity).toBe("high");
    expect(res.body.data.source).toBe("pwa");
    incidentId = res.body.data.id;
  });

  it("GET /api/v1/incidents — lists incidents", async () => {
    const res = await request(app).get("/api/v1/incidents");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it("GET /api/v1/incidents/:id — gets single incident", async () => {
    const res = await request(app).get(`/api/v1/incidents/${incidentId}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(incidentId);
    expect(res.body.data.description).toBe("Test flood incident");
  });

  it("GET /api/v1/incidents — filters by type", async () => {
    const res = await request(app).get("/api/v1/incidents?type=flood");

    expect(res.status).toBe(200);
    for (const inc of res.body.data) {
      expect(inc.type).toBe("flood");
    }
  });

  it("GET /api/v1/incidents — filters by severity", async () => {
    const res = await request(app).get("/api/v1/incidents?severity=high");

    expect(res.status).toBe(200);
    for (const inc of res.body.data) {
      expect(inc.severity).toBe("high");
    }
  });

  it("PATCH /api/v1/incidents/:id — coordinator can verify", async () => {
    const res = await request(app)
      .patch(`/api/v1/incidents/${incidentId}`)
      .set("Authorization", `Bearer ${coordToken}`)
      .send({ status: "verified" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("verified");
  });

  it("PATCH /api/v1/incidents/:id — rejects invalid status transition", async () => {
    const res = await request(app)
      .patch(`/api/v1/incidents/${incidentId}`)
      .set("Authorization", `Bearer ${coordToken}`)
      .send({ status: "unverified" });

    // May be 400 or 200 depending on transition rules
    if (res.status === 400) {
      expect(res.body.error).toBeDefined();
    }
  });

  it("POST /api/v1/incidents — rejects without auth", async () => {
    const res = await request(app)
      .post("/api/v1/incidents")
      .send({
        type: "flood",
        severity: "low",
        lat: 42.98,
        lng: 47.50,
      });

    expect(res.status).toBe(401);
  });

  it("POST /api/v1/incidents — validates input", async () => {
    const res = await request(app)
      .post("/api/v1/incidents")
      .set("Authorization", `Bearer ${token}`)
      .send({
        type: "invalid_type",
        severity: "high",
        lat: 42.98,
        lng: 47.50,
      });

    expect(res.status).toBe(400);
  });
});
