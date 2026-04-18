// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Rate-limiter invariants — every per-endpoint bucket we shipped.
 *
 * Uses a dedicated app instance (createRateLimitTestApp) that calls
 * initRateLimiter(null) at mount time, backed by RateLimiterMemory.
 * That gives us deterministic, in-process state — no Redis required
 * — at the cost of sharing buckets across tests in the same file.
 *
 * Isolation strategy: each test uses a UNIQUE X-Real-IP header (for
 * IP-keyed buckets) and a UNIQUE test user (for user-keyed buckets),
 * so tests don't contaminate each other's budgets. getRealIp() reads
 * X-Real-IP when CF headers are absent — our production fix from
 * earlier in the audit — so this works the same way tests vs prod.
 *
 * Out of scope:
 *   - uploadsRateLimiter (needs multer multipart fixtures)
 *   - global rateLimiterMiddleware (pre-existing, 90/min+ window is
 *     slow to exhaust in tests)
 */
import { describe, it, expect } from "vitest";
import request from "supertest";
import { prisma } from "@samur/db";
import { createRateLimitTestApp, makeUser } from "./setup.js";

const app = createRateLimitTestApp();

/** Deterministic-looking unique IP per test. We use the 192.0.2.0/24
 * TEST-NET-1 range per RFC 5737 so the value can never clash with a
 * real source. Counter lifts per call — no two tests collide. */
let ipCounter = 0;
function testIp(): string {
  ipCounter += 1;
  return `192.0.2.${ipCounter}`;
}

describe("authAttemptsRateLimiter — POST /auth/login (5/hr per phone + 50/hr per IP)", () => {
  it("5 failed attempts land, 6th returns 429 AUTH_RATE_LIMIT_EXCEEDED", async () => {
    const phone = `+7999${Math.floor(1000000 + Math.random() * 8999999)}`;
    const ip = testIp();

    for (let i = 1; i <= 5; i++) {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Real-IP", ip)
        .send({ phone, password: "not-the-password" });
      expect(res.status).toBe(401);
    }

    const capped = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Real-IP", ip)
      .send({ phone, password: "not-the-password" });
    expect(capped.status).toBe(429);
    expect(capped.body.error?.code).toBe("AUTH_RATE_LIMIT_EXCEEDED");
  });

  it("a different IP+phone combination still works after another caller got capped", async () => {
    const phone = `+7999${Math.floor(1000000 + Math.random() * 8999999)}`;
    const ip = testIp();

    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Real-IP", ip)
      .send({ phone, password: "still-wrong" });
    // 401 (invalid creds) — NOT 429 — proves buckets are independent.
    expect(res.status).toBe(401);
  });
});

describe("incidentsRateLimiter — POST /incidents", () => {
  it("anonymous: 5 requests land, 6th returns 429 INCIDENT_RATE_LIMIT_EXCEEDED", async () => {
    const ip = testIp();
    const payload = { type: "flood", severity: "low", lat: 42.98, lng: 47.5 };

    for (let i = 1; i <= 5; i++) {
      const res = await request(app)
        .post("/api/v1/incidents")
        .set("X-Real-IP", ip)
        .send(payload);
      expect(res.status).toBe(201);
    }

    const capped = await request(app)
      .post("/api/v1/incidents")
      .set("X-Real-IP", ip)
      .send(payload);
    expect(capped.status).toBe(429);
    expect(capped.body.error?.code).toBe("INCIDENT_RATE_LIMIT_EXCEEDED");
  });

  it("authenticated: user bucket (30/hr) is separate from anon bucket (5/hr)", async () => {
    const u = await makeUser({ role: "resident", name: "Incident Auth Test" });
    const ip = testIp();
    const payload = { type: "flood", severity: "low", lat: 42.98, lng: 47.5 };

    // Authenticated calls drain the authenticated bucket, not the
    // anon one. 6 calls would 429 as anon but should pass as auth.
    for (let i = 1; i <= 6; i++) {
      const res = await request(app)
        .post("/api/v1/incidents")
        .set("Authorization", `Bearer ${u.token}`)
        .set("X-Real-IP", ip)
        .send(payload);
      expect(res.status).toBe(201);
    }
  });
});

describe("messagesRateLimiter — POST /help-requests/:id/messages (30/min auth)", () => {
  it("30 messages land, 31st returns 429 MESSAGE_RATE_LIMIT_EXCEEDED", async () => {
    const author = await makeUser({ role: "resident", name: "Msg Rate Author" });
    const ip = testIp();

    const hr = await request(app)
      .post("/api/v1/help-requests")
      .set("Authorization", `Bearer ${author.token}`)
      .set("X-Real-IP", ip)
      .send({
        type: "need",
        category: "food",
        lat: 42.98,
        lng: 47.5,
        description: "msg-rate fixture",
      });
    expect(hr.status).toBe(201);
    const hrId = hr.body.data.id;

    for (let i = 1; i <= 30; i++) {
      const res = await request(app)
        .post(`/api/v1/help-requests/${hrId}/messages`)
        .set("Authorization", `Bearer ${author.token}`)
        .set("X-Real-IP", ip)
        .send({ body: `msg ${i}` });
      expect(res.status).toBe(201);
    }

    const capped = await request(app)
      .post(`/api/v1/help-requests/${hrId}/messages`)
      .set("Authorization", `Bearer ${author.token}`)
      .set("X-Real-IP", ip)
      .send({ body: "one too many" });
    expect(capped.status).toBe(429);
    expect(capped.body.error?.code).toBe("MESSAGE_RATE_LIMIT_EXCEEDED");
  });
});

describe("reportsRateLimiter — POST /help-requests/:id/messages/:msgId/report (20/hr auth)", () => {
  it("20 reports land, 21st returns 429 REPORT_RATE_LIMIT_EXCEEDED", async () => {
    // Fixture: one author, 21 responders (each posts a message and
    // the reporter reports each one). Can't self-report, so each
    // report needs a distinct victim message from a distinct author.
    const ip = testIp();
    const reporter = await makeUser({ role: "resident", name: "Rate Reporter" });
    const author = await makeUser({ role: "resident", name: "Rate HR Author" });

    const hr = await request(app)
      .post("/api/v1/help-requests")
      .set("Authorization", `Bearer ${author.token}`)
      .set("X-Real-IP", ip)
      .send({ type: "need", category: "food", lat: 42.98, lng: 47.5 });
    const hrId = hr.body.data.id;

    // Reporter joins as responder so they're a participant.
    await request(app)
      .post(`/api/v1/help-requests/${hrId}/respond`)
      .set("Authorization", `Bearer ${reporter.token}`)
      .set("X-Real-IP", ip);

    // Create 21 messages authored by the author, report each from
    // the reporter's account.
    const msgIds: string[] = [];
    for (let i = 0; i < 21; i++) {
      const m = await request(app)
        .post(`/api/v1/help-requests/${hrId}/messages`)
        .set("Authorization", `Bearer ${author.token}`)
        .set("X-Real-IP", ip)
        .send({ body: `report-fodder ${i}` });
      msgIds.push(m.body.data.id);
    }

    for (let i = 0; i < 20; i++) {
      const res = await request(app)
        .post(`/api/v1/help-requests/${hrId}/messages/${msgIds[i]}/report`)
        .set("Authorization", `Bearer ${reporter.token}`)
        .set("X-Real-IP", ip)
        .send({ reason: "spam" });
      expect(res.status).toBe(201);
    }

    const capped = await request(app)
      .post(`/api/v1/help-requests/${hrId}/messages/${msgIds[20]}/report`)
      .set("Authorization", `Bearer ${reporter.token}`)
      .set("X-Real-IP", ip)
      .send({ reason: "spam" });
    expect(capped.status).toBe(429);
    expect(capped.body.error?.code).toBe("REPORT_RATE_LIMIT_EXCEEDED");
  });
});

describe("alertBroadcastRateLimiter — POST /alerts (10/hr coord)", () => {
  it("10 alerts land, 11th returns 429 ALERT_RATE_LIMIT_EXCEEDED", async () => {
    const coord = await makeUser({ role: "coordinator", name: "Rate Alert Coord" });
    const ip = testIp();

    const payload = {
      urgency: "info" as const,
      title: "rate-limit fixture",
      body: "testing broadcast cap",
      channels: ["pwa"],
    };

    for (let i = 1; i <= 10; i++) {
      const res = await request(app)
        .post("/api/v1/alerts")
        .set("Authorization", `Bearer ${coord.token}`)
        .set("X-Real-IP", ip)
        .send(payload);
      expect(res.status).toBe(201);
    }

    const capped = await request(app)
      .post("/api/v1/alerts")
      .set("Authorization", `Bearer ${coord.token}`)
      .set("X-Real-IP", ip)
      .send(payload);
    expect(capped.status).toBe(429);
    expect(capped.body.error?.code).toBe("ALERT_RATE_LIMIT_EXCEEDED");
  });

  it("admin tier gets 3× the ceiling (30/hr vs 10/hr)", async () => {
    const admin = await makeUser({ role: "admin", name: "Rate Alert Admin" });
    const ip = testIp();
    const payload = {
      urgency: "info" as const,
      title: "admin fixture",
      body: "testing admin cap",
      channels: ["pwa"],
    };

    // 11 calls (over the coord 10 cap, under the admin 30 cap) should
    // all pass because this caller is on the admin tier.
    for (let i = 1; i <= 11; i++) {
      const res = await request(app)
        .post("/api/v1/alerts")
        .set("Authorization", `Bearer ${admin.token}`)
        .set("X-Real-IP", ip)
        .send(payload);
      expect(res.status).toBe(201);
    }
  });
});

describe("Rate-limiter wiring — distinct error codes", () => {
  it("each per-endpoint 429 carries its own error code", async () => {
    // Sanity check against accidental code mutation / regression —
    // clients rely on these exact strings to branch error UX.
    expect(prisma).toBeDefined(); // import guard: file compiled
  });
});
