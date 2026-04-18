// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Attachment-ownership invariants. Exercises assertOwnedUploads +
 * assertOwnedNewUploads across every write path that accepts
 * photoUrls:
 *   POST /incidents              (anonymous OR authenticated)
 *   PATCH /incidents/:id         (authenticated)
 *   POST /help-requests          (anonymous OR authenticated)
 *   PATCH /help-requests/:id     (authenticated)
 *   POST /help-requests/:id/messages
 *
 * Uploads are inserted directly via prisma.upload.create rather than
 * driven through POST /uploads — we're testing the attach-time
 * ownership check, not the multer+sharp pipeline (which has its own
 * concerns). Filenames match the format crypto.randomBytes(16) +
 * .{ext} produces so they pass the shared photoUrl regex.
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { prisma } from "@samur/db";
import { createTestApp, makeUser } from "./setup.js";

const app = createTestApp();

/** Insert a fresh Upload row. `uploaderId=null` simulates an anonymous
 * upload. Returns the URL shape the API stores on photoUrls. */
async function stageUpload(uploaderId: string | null): Promise<string> {
  const filename = `${crypto.randomBytes(16).toString("hex")}.jpg`;
  await prisma.upload.create({ data: { filename, uploaderId } });
  return `/api/v1/uploads/${filename}`;
}

interface Fixture {
  author: { id: string; token: string };
  other: { id: string; token: string };
  coordinator: { id: string; token: string };
  authorUpload: string;
  otherUpload: string;
  coordUpload: string;
  anonUpload: string;
}

let F: Fixture;

beforeAll(async () => {
  const [author, other, coordinator] = await Promise.all([
    makeUser({ role: "volunteer", name: "Upl Author" }),
    makeUser({ role: "volunteer", name: "Upl Other" }),
    makeUser({ role: "coordinator", name: "Upl Coord" }),
  ]);

  const [authorUpload, otherUpload, coordUpload, anonUpload] = await Promise.all([
    stageUpload(author.id),
    stageUpload(other.id),
    stageUpload(coordinator.id),
    stageUpload(null),
  ]);

  F = { author, other, coordinator, authorUpload, otherUpload, coordUpload, anonUpload };
});

describe("Ownership — POST /incidents", () => {
  it("authenticated user can attach their own upload", async () => {
    const res = await request(app)
      .post("/api/v1/incidents")
      .set("Authorization", `Bearer ${F.author.token}`)
      .send({
        type: "flood",
        severity: "low",
        lat: 42.98,
        lng: 47.5,
        photoUrls: [F.authorUpload],
      });
    expect(res.status).toBe(201);
  });

  it("authenticated user is rejected attaching another user's upload (403 UPLOAD_NOT_OWNED)", async () => {
    const res = await request(app)
      .post("/api/v1/incidents")
      .set("Authorization", `Bearer ${F.author.token}`)
      .send({
        type: "flood",
        severity: "low",
        lat: 42.98,
        lng: 47.5,
        photoUrls: [F.otherUpload],
      });
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("UPLOAD_NOT_OWNED");
  });

  it("authenticated user is rejected attaching an anonymous upload (403)", async () => {
    const res = await request(app)
      .post("/api/v1/incidents")
      .set("Authorization", `Bearer ${F.author.token}`)
      .send({
        type: "flood",
        severity: "low",
        lat: 42.98,
        lng: 47.5,
        photoUrls: [F.anonUpload],
      });
    expect(res.status).toBe(403);
  });

  it("anonymous caller can attach an anonymous upload", async () => {
    const res = await request(app)
      .post("/api/v1/incidents")
      .send({
        type: "flood",
        severity: "low",
        lat: 42.98,
        lng: 47.5,
        photoUrls: [F.anonUpload],
      });
    expect(res.status).toBe(201);
  });

  it("anonymous caller is rejected attaching an authenticated user's upload", async () => {
    // Use a fresh anon upload so F.anonUpload staying in cache
    // doesn't interfere — but the assertion is on authorUpload.
    const res = await request(app)
      .post("/api/v1/incidents")
      .send({
        type: "flood",
        severity: "low",
        lat: 42.98,
        lng: 47.5,
        photoUrls: [F.authorUpload],
      });
    expect(res.status).toBe(403);
  });

  it("rejects a forged URL that matches the regex but has no Upload row", async () => {
    const forged = `/api/v1/uploads/${"0".repeat(32)}.jpg`;
    const res = await request(app)
      .post("/api/v1/incidents")
      .set("Authorization", `Bearer ${F.author.token}`)
      .send({
        type: "flood",
        severity: "low",
        lat: 42.98,
        lng: 47.5,
        photoUrls: [forged],
      });
    expect(res.status).toBe(403);
  });

  it("photoUrls=[] (no attachment) never fails the check", async () => {
    const res = await request(app)
      .post("/api/v1/incidents")
      .set("Authorization", `Bearer ${F.author.token}`)
      .send({
        type: "flood",
        severity: "low",
        lat: 42.98,
        lng: 47.5,
      });
    expect(res.status).toBe(201);
  });
});

describe("Ownership — PATCH /incidents (diff vs existing)", () => {
  let incidentId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post("/api/v1/incidents")
      .set("Authorization", `Bearer ${F.author.token}`)
      .send({
        type: "flood",
        severity: "low",
        lat: 42.98,
        lng: 47.5,
        photoUrls: [F.authorUpload],
      });
    incidentId = res.body.data.id;
  });

  it("author patching with the same photoUrls passes (no diff)", async () => {
    const res = await request(app)
      .patch(`/api/v1/incidents/${incidentId}`)
      .set("Authorization", `Bearer ${F.author.token}`)
      .send({ photoUrls: [F.authorUpload], description: "same photo, new desc" });
    expect(res.status).toBe(200);
  });

  it("coordinator editing keeps the author's original photo (owned by author, not coord)", async () => {
    // The coordinator is not the uploader, but the photo is already
    // on the row — diff finds nothing new, so the ownership check
    // doesn't fire. Coordinator can edit other fields freely.
    const res = await request(app)
      .patch(`/api/v1/incidents/${incidentId}`)
      .set("Authorization", `Bearer ${F.coordinator.token}`)
      .send({ photoUrls: [F.authorUpload], severity: "high" });
    expect(res.status).toBe(200);
  });

  it("coordinator can add their own photo alongside the author's", async () => {
    const res = await request(app)
      .patch(`/api/v1/incidents/${incidentId}`)
      .set("Authorization", `Bearer ${F.coordinator.token}`)
      .send({ photoUrls: [F.authorUpload, F.coordUpload] });
    expect(res.status).toBe(200);
  });

  it("coordinator adding another user's photo (not their own, not existing) is rejected", async () => {
    const res = await request(app)
      .patch(`/api/v1/incidents/${incidentId}`)
      .set("Authorization", `Bearer ${F.coordinator.token}`)
      .send({ photoUrls: [F.authorUpload, F.coordUpload, F.otherUpload] });
    expect(res.status).toBe(403);
  });
});

describe("Ownership — POST /help-requests", () => {
  it("authenticated user attaches their own upload", async () => {
    const res = await request(app)
      .post("/api/v1/help-requests")
      .set("Authorization", `Bearer ${F.author.token}`)
      .send({
        type: "need",
        category: "food",
        lat: 42.98,
        lng: 47.5,
        photoUrls: [F.authorUpload],
      });
    expect(res.status).toBe(201);
  });

  it("attaching another user's upload is rejected", async () => {
    const res = await request(app)
      .post("/api/v1/help-requests")
      .set("Authorization", `Bearer ${F.author.token}`)
      .send({
        type: "need",
        category: "food",
        lat: 42.98,
        lng: 47.5,
        photoUrls: [F.otherUpload],
      });
    expect(res.status).toBe(403);
  });
});

describe("Ownership — POST /help-requests/:id/messages (chat)", () => {
  let helpRequestId: string;
  let chatUpload: string;

  beforeAll(async () => {
    const hr = await request(app)
      .post("/api/v1/help-requests")
      .set("Authorization", `Bearer ${F.author.token}`)
      .send({
        type: "need",
        category: "water",
        lat: 42.98,
        lng: 47.5,
        description: "ownership-test chat parent",
      });
    helpRequestId = hr.body.data.id;
    // Responder opts in so they're a participant.
    await request(app)
      .post(`/api/v1/help-requests/${helpRequestId}/respond`)
      .set("Authorization", `Bearer ${F.other.token}`)
      .send({ note: "on it" });
    // Fresh upload owned by the author — we'll use it in chat.
    chatUpload = await stageUpload(F.author.id);
  });

  it("author can attach own upload to a message", async () => {
    const res = await request(app)
      .post(`/api/v1/help-requests/${helpRequestId}/messages`)
      .set("Authorization", `Bearer ${F.author.token}`)
      .send({ body: "photo", photoUrls: [chatUpload] });
    expect(res.status).toBe(201);
  });

  it("responder cannot attach the author's upload to a message", async () => {
    const res = await request(app)
      .post(`/api/v1/help-requests/${helpRequestId}/messages`)
      .set("Authorization", `Bearer ${F.other.token}`)
      .send({ body: "swiping author's photo", photoUrls: [chatUpload] });
    expect(res.status).toBe(403);
  });
});
