// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Messenger (help-request chat) invariants.
 *
 * Covers the core security properties we shipped across the messenger
 * audit: who can read, who can write, who can moderate, what happens
 * when a responder is removed. Rate-limit behavior is NOT tested here
 * — the test app doesn't init the rate limiter, so every call is
 * unthrottled. Socket-level behavior (room scoping, typing) is also
 * out of scope for the HTTP supertest harness.
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { prisma } from "@samur/db";
import { createTestApp, makeUser } from "./setup.js";

const app = createTestApp();

interface Fixture {
  author: { id: string; token: string };
  responder: { id: string; token: string };
  secondResponder: { id: string; token: string };
  outsider: { id: string; token: string };
  coordinator: { id: string; token: string };
  helpRequestId: string;
}

let F: Fixture;

beforeAll(async () => {
  const [author, responder, secondResponder, outsider, coordinator] = await Promise.all([
    makeUser({ role: "resident", name: "Msg Author" }),
    makeUser({ role: "volunteer", name: "Msg Responder 1" }),
    makeUser({ role: "volunteer", name: "Msg Responder 2" }),
    makeUser({ role: "resident", name: "Msg Outsider" }),
    makeUser({ role: "coordinator", name: "Msg Coordinator" }),
  ]);

  // Author creates a help request — makes them the request's userId.
  const hrRes = await request(app)
    .post("/api/v1/help-requests")
    .set("Authorization", `Bearer ${author.token}`)
    .send({
      type: "need",
      category: "food",
      lat: 42.98,
      lng: 47.5,
      description: "Messenger fixture — need food",
      urgency: "urgent",
    });
  expect(hrRes.status).toBe(201);

  // Both responders opt in.
  await Promise.all([
    request(app)
      .post(`/api/v1/help-requests/${hrRes.body.data.id}/respond`)
      .set("Authorization", `Bearer ${responder.token}`)
      .send({ note: "on my way" }),
    request(app)
      .post(`/api/v1/help-requests/${hrRes.body.data.id}/respond`)
      .set("Authorization", `Bearer ${secondResponder.token}`)
      .send({ note: "I'll bring water" }),
  ]);

  F = {
    author,
    responder,
    secondResponder,
    outsider,
    coordinator,
    helpRequestId: hrRes.body.data.id,
  };
});

describe("Messenger — access scoping", () => {
  it("author can POST a message", async () => {
    const res = await request(app)
      .post(`/api/v1/help-requests/${F.helpRequestId}/messages`)
      .set("Authorization", `Bearer ${F.author.token}`)
      .send({ body: "hi, thank you for responding" });
    expect(res.status).toBe(201);
    expect(res.body.data.body).toBe("hi, thank you for responding");
  });

  it("active responder can POST a message", async () => {
    const res = await request(app)
      .post(`/api/v1/help-requests/${F.helpRequestId}/messages`)
      .set("Authorization", `Bearer ${F.responder.token}`)
      .send({ body: "on my way" });
    expect(res.status).toBe(201);
  });

  it("coordinator can POST a message", async () => {
    const res = await request(app)
      .post(`/api/v1/help-requests/${F.helpRequestId}/messages`)
      .set("Authorization", `Bearer ${F.coordinator.token}`)
      .send({ body: "checking in" });
    expect(res.status).toBe(201);
  });

  it("participant can GET messages", async () => {
    const res = await request(app)
      .get(`/api/v1/help-requests/${F.helpRequestId}/messages`)
      .set("Authorization", `Bearer ${F.responder.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it("non-participant GET returns 403 NOT_PARTICIPANT", async () => {
    const res = await request(app)
      .get(`/api/v1/help-requests/${F.helpRequestId}/messages`)
      .set("Authorization", `Bearer ${F.outsider.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("NOT_PARTICIPANT");
  });

  it("non-participant POST returns 403 NOT_PARTICIPANT", async () => {
    const res = await request(app)
      .post(`/api/v1/help-requests/${F.helpRequestId}/messages`)
      .set("Authorization", `Bearer ${F.outsider.token}`)
      .send({ body: "I should not be able to say this" });
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("NOT_PARTICIPANT");
  });

  it("unauthenticated POST returns 401", async () => {
    const res = await request(app)
      .post(`/api/v1/help-requests/${F.helpRequestId}/messages`)
      .send({ body: "no auth" });
    expect(res.status).toBe(401);
  });
});

describe("Messenger — cancelled responder loses access", () => {
  it("secondResponder can POST before cancelling", async () => {
    const res = await request(app)
      .post(`/api/v1/help-requests/${F.helpRequestId}/messages`)
      .set("Authorization", `Bearer ${F.secondResponder.token}`)
      .send({ body: "still in" });
    expect(res.status).toBe(201);
  });

  it("secondResponder cancels their response", async () => {
    const res = await request(app)
      .delete(`/api/v1/help-requests/${F.helpRequestId}/my-response`)
      .set("Authorization", `Bearer ${F.secondResponder.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.cancelled).toBe(true);
  });

  it("cancelled responder GET 403s", async () => {
    const res = await request(app)
      .get(`/api/v1/help-requests/${F.helpRequestId}/messages`)
      .set("Authorization", `Bearer ${F.secondResponder.token}`);
    expect(res.status).toBe(403);
  });

  it("cancelled responder POST 403s", async () => {
    const res = await request(app)
      .post(`/api/v1/help-requests/${F.helpRequestId}/messages`)
      .set("Authorization", `Bearer ${F.secondResponder.token}`)
      .send({ body: "still typing after cancel" });
    expect(res.status).toBe(403);
  });
});

describe("Messenger — report + moderate", () => {
  let reportedMessageId: string;

  beforeAll(async () => {
    // Responder posts a message, author will report it.
    const res = await request(app)
      .post(`/api/v1/help-requests/${F.helpRequestId}/messages`)
      .set("Authorization", `Bearer ${F.responder.token}`)
      .send({ body: "message that will get reported" });
    reportedMessageId = res.body.data.id;
  });

  it("self-report on own message is rejected with 400 CANNOT_REPORT_OWN", async () => {
    const res = await request(app)
      .post(`/api/v1/help-requests/${F.helpRequestId}/messages/${reportedMessageId}/report`)
      .set("Authorization", `Bearer ${F.responder.token}`)
      .send({ reason: "other", details: "trying to self-report" });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("CANNOT_REPORT_OWN");
  });

  it("non-participant cannot report", async () => {
    const res = await request(app)
      .post(`/api/v1/help-requests/${F.helpRequestId}/messages/${reportedMessageId}/report`)
      .set("Authorization", `Bearer ${F.outsider.token}`)
      .send({ reason: "spam" });
    expect(res.status).toBe(403);
  });

  it("participant can report another's message", async () => {
    const res = await request(app)
      .post(`/api/v1/help-requests/${F.helpRequestId}/messages/${reportedMessageId}/report`)
      .set("Authorization", `Bearer ${F.author.token}`)
      .send({ reason: "abuse", details: "unkind message" });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("open");
  });

  it("duplicate report from same user upserts (no 409)", async () => {
    const res = await request(app)
      .post(`/api/v1/help-requests/${F.helpRequestId}/messages/${reportedMessageId}/report`)
      .set("Authorization", `Bearer ${F.author.token}`)
      .send({ reason: "spam", details: "on second thought, it's spam" });
    expect(res.status).toBe(201);

    const reports = await prisma.helpMessageReport.findMany({
      where: { messageId: reportedMessageId, reporterId: F.author.id },
    });
    expect(reports.length).toBe(1);
    expect(reports[0].reason).toBe("spam");
  });

  it("non-coordinator cannot DELETE a message", async () => {
    const res = await request(app)
      .delete(`/api/v1/help-requests/${F.helpRequestId}/messages/${reportedMessageId}`)
      .set("Authorization", `Bearer ${F.author.token}`);
    expect(res.status).toBe(403);
  });

  it("coordinator DELETE soft-deletes + resolves open reports", async () => {
    const res = await request(app)
      .delete(`/api/v1/help-requests/${F.helpRequestId}/messages/${reportedMessageId}`)
      .set("Authorization", `Bearer ${F.coordinator.token}`);
    expect(res.status).toBe(200);

    const msg = await prisma.helpMessage.findUnique({ where: { id: reportedMessageId } });
    expect(msg?.deletedAt).not.toBeNull();
    expect(msg?.deletedBy).toBe(F.coordinator.id);

    const openReports = await prisma.helpMessageReport.count({
      where: { messageId: reportedMessageId, status: "open" },
    });
    expect(openReports).toBe(0);
  });

  it("GET messages strips body/photoUrls on deleted rows", async () => {
    const res = await request(app)
      .get(`/api/v1/help-requests/${F.helpRequestId}/messages`)
      .set("Authorization", `Bearer ${F.author.token}`);
    expect(res.status).toBe(200);
    const deleted = (res.body.data as Array<{ id: string; body: string; deletedAt: string | null }>).find(
      (m) => m.id === reportedMessageId,
    );
    expect(deleted).toBeDefined();
    expect(deleted!.body).toBe("");
    expect(deleted!.deletedAt).not.toBeNull();
  });
});

describe("Messenger — author-removes-participant", () => {
  let victim: { id: string; token: string };

  beforeAll(async () => {
    victim = await makeUser({ role: "volunteer", name: "Msg Victim" });
    await request(app)
      .post(`/api/v1/help-requests/${F.helpRequestId}/respond`)
      .set("Authorization", `Bearer ${victim.token}`)
      .send({ note: "I can help" });
  });

  it("victim can POST before being removed", async () => {
    const res = await request(app)
      .post(`/api/v1/help-requests/${F.helpRequestId}/messages`)
      .set("Authorization", `Bearer ${victim.token}`)
      .send({ body: "still here" });
    expect(res.status).toBe(201);
  });

  it("non-author, non-coordinator cannot remove participant", async () => {
    const res = await request(app)
      .delete(`/api/v1/help-requests/${F.helpRequestId}/participants/${victim.id}`)
      .set("Authorization", `Bearer ${F.responder.token}`);
    expect(res.status).toBe(403);
  });

  it("author can remove a responder", async () => {
    const res = await request(app)
      .delete(`/api/v1/help-requests/${F.helpRequestId}/participants/${victim.id}`)
      .set("Authorization", `Bearer ${F.author.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.removed).toBe(true);
  });

  it("author cannot remove themselves", async () => {
    const res = await request(app)
      .delete(`/api/v1/help-requests/${F.helpRequestId}/participants/${F.author.id}`)
      .set("Authorization", `Bearer ${F.author.token}`);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("CANNOT_REMOVE_AUTHOR");
  });

  it("removed participant can no longer POST", async () => {
    const res = await request(app)
      .post(`/api/v1/help-requests/${F.helpRequestId}/messages`)
      .set("Authorization", `Bearer ${victim.token}`)
      .send({ body: "I should be locked out" });
    expect(res.status).toBe(403);
  });
});

describe("Messenger — moderation queue (admin)", () => {
  it("coordinator lists open reports", async () => {
    const res = await request(app)
      .get("/api/v1/moderation/message-reports?status=open")
      .set("Authorization", `Bearer ${F.coordinator.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("non-coordinator gets 403", async () => {
    const res = await request(app)
      .get("/api/v1/moderation/message-reports")
      .set("Authorization", `Bearer ${F.responder.token}`);
    expect(res.status).toBe(403);
  });

  it("unauthenticated gets 401", async () => {
    const res = await request(app).get("/api/v1/moderation/message-reports");
    expect(res.status).toBe(401);
  });
});
