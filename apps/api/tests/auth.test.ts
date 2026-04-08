// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createTestApp } from "./setup.js";

const app = createTestApp();

const testPhone = "+79990009999";
const testPassword = "testpass123";

describe("Auth flow", () => {
  it("POST /api/v1/auth/register — registers new user", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Auth Test",
        phone: testPhone,
        password: testPassword,
        role: "resident",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.phone).toBe(testPhone);
    expect(res.body.data.user.role).toBe("resident");
  });

  it("POST /api/v1/auth/register — rejects duplicate phone", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Duplicate",
        phone: testPhone,
        password: testPassword,
      });

    expect(res.status).toBe(409);
  });

  it("POST /api/v1/auth/login — logs in with correct credentials", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({
        phone: testPhone,
        password: testPassword,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeDefined();
  });

  it("POST /api/v1/auth/login — rejects wrong password", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({
        phone: testPhone,
        password: "wrongpassword",
      });

    expect(res.status).toBe(401);
  });

  it("POST /api/v1/auth/login — rejects nonexistent user", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({
        phone: "+79990000000",
        password: testPassword,
      });

    expect(res.status).toBe(401);
  });

  it("authenticated request works with valid token", async () => {
    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ phone: testPhone, password: testPassword });

    const token = loginRes.body.data.token;

    const res = await request(app)
      .get("/api/v1/incidents")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it("rejects request with invalid token", async () => {
    const res = await request(app)
      .post("/api/v1/incidents")
      .set("Authorization", "Bearer invalid.token.here")
      .send({
        type: "flood",
        severity: "low",
        lat: 42.98,
        lng: 47.50,
      });

    expect(res.status).toBe(401);
  });
});
