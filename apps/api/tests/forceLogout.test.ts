// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Admin force-logout endpoint. Exercises the authorization gates and
 * confirms the primitive composes correctly with tokenVersion — the
 * target's outstanding JWT actually 401s after the bump.
 *
 * Companion to tokenRevocation.test.ts, which covers self-logout and
 * the underlying middleware check. This file focuses on the admin-
 * facing entry point.
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { prisma } from "@samur/db";
import { createTestApp, makeUser } from "./setup.js";

const app = createTestApp();

interface Fixture {
  coordinator: { id: string; token: string };
  admin: { id: string; token: string };
  resident: { id: string; token: string };
  target: { id: string; token: string };
}
let F: Fixture;

beforeAll(async () => {
  const [coordinator, admin, resident, target] = await Promise.all([
    makeUser({ role: "coordinator", name: "FL Coord" }),
    makeUser({ role: "admin", name: "FL Admin" }),
    makeUser({ role: "resident", name: "FL Resident" }),
    makeUser({ role: "volunteer", name: "FL Target" }),
  ]);
  F = { coordinator, admin, resident, target };
});

describe("Admin force-logout — authorization", () => {
  it("unauthenticated 401s", async () => {
    const res = await request(app)
      .post(`/api/v1/admin/users/${F.target.id}/force-logout`);
    expect(res.status).toBe(401);
  });

  it("resident (non-admin) 403s", async () => {
    const res = await request(app)
      .post(`/api/v1/admin/users/${F.target.id}/force-logout`)
      .set("Authorization", `Bearer ${F.resident.token}`);
    expect(res.status).toBe(403);
  });

  it("coordinator targeting themselves is rejected with 400 SELF_TARGET", async () => {
    const res = await request(app)
      .post(`/api/v1/admin/users/${F.coordinator.id}/force-logout`)
      .set("Authorization", `Bearer ${F.coordinator.token}`);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("SELF_TARGET");
  });

  it("nonexistent target 404s", async () => {
    const res = await request(app)
      .post("/api/v1/admin/users/does-not-exist/force-logout")
      .set("Authorization", `Bearer ${F.coordinator.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe("USER_NOT_FOUND");
  });
});

describe("Admin force-logout — effect", () => {
  it("coordinator can force-logout a regular user + target's token is revoked", async () => {
    // Before: target's token works.
    const pre = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${F.target.token}`);
    expect(pre.status).toBe(200);

    // Coordinator hits the endpoint.
    const res = await request(app)
      .post(`/api/v1/admin/users/${F.target.id}/force-logout`)
      .set("Authorization", `Bearer ${F.coordinator.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.userId).toBe(F.target.id);
    expect(typeof res.body.data.tokenVersion).toBe("number");

    // DB version was bumped.
    const row = await prisma.user.findUnique({ where: { id: F.target.id } });
    expect(row!.tokenVersion).toBe(res.body.data.tokenVersion);
    expect(row!.tokenVersion).toBeGreaterThan(0);

    // Target's outstanding token is now revoked.
    const post = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${F.target.token}`);
    expect(post.status).toBe(401);
    expect(post.body.error?.code).toBe("TOKEN_REVOKED");
  });

  it("admin role also authorized (not just coordinator)", async () => {
    const victim = await makeUser({ role: "resident", name: "FL Admin Victim" });
    const res = await request(app)
      .post(`/api/v1/admin/users/${victim.id}/force-logout`)
      .set("Authorization", `Bearer ${F.admin.token}`);
    expect(res.status).toBe(200);

    const post = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${victim.token}`);
    expect(post.status).toBe(401);
  });

  it("coordinator's own session stays valid after forcing another user out", async () => {
    const follow = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${F.coordinator.token}`);
    expect(follow.status).toBe(200);
  });
});
