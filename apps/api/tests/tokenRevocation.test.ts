// SPDX-License-Identifier: AGPL-3.0-only
/**
 * JWT revocation invariants (audit item M2).
 *
 * Covers the tokenVersion mechanism end-to-end:
 *   - valid token at current version → request passes
 *   - legacy tokens (no tokenVersion field) treated as 0 →
 *     still pass for users at default version 0
 *   - after user.tokenVersion bumps (via logout-all or role change),
 *     tokens at the old version 401 with TOKEN_REVOKED
 *   - deleted users are equivalent to revoked
 *
 * Rate-limit wrapping on /auth/logout-all is not active in the test
 * app (no initRateLimiter), so we can call it freely.
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { prisma } from "@samur/db";
import { createTestApp, makeUser, makeToken } from "./setup.js";

const app = createTestApp();

describe("JWT revocation — tokenVersion", () => {
  it("valid token at current version passes", async () => {
    const u = await makeUser();
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${u.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(u.id);
  });

  it("legacy token (no tokenVersion in payload) passes for user at version 0", async () => {
    const u = await makeUser();
    const legacyToken = makeToken(u.id, u.role);
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${legacyToken}`);
    expect(res.status).toBe(200);
  });

  it("token with version below current gets 401 TOKEN_REVOKED", async () => {
    const u = await makeUser();
    // Simulate a stale token: server bumps version to 1, but the token
    // was signed at version 0.
    await prisma.user.update({
      where: { id: u.id },
      data: { tokenVersion: { increment: 1 } },
    });
    // Cache invalidation — in production this happens inside
    // incrementTokenVersion. Call it via the HTTP endpoint to keep
    // the same path under test.
    // (Direct DB update above is fine; getTokenVersion hits DB on
    // cache miss. 30s TTL means eventual consistency, but with a
    // freshly-created test user there's nothing cached yet.)

    const staleToken = makeToken(u.id, u.role, 0);
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${staleToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("TOKEN_REVOKED");
  });

  it("token at bumped version passes", async () => {
    const u = await makeUser();
    await prisma.user.update({
      where: { id: u.id },
      data: { tokenVersion: { increment: 1 } },
    });
    const fresh = await prisma.user.findUnique({ where: { id: u.id } });
    const freshToken = makeToken(u.id, u.role, fresh!.tokenVersion);

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${freshToken}`);
    expect(res.status).toBe(200);
  });

  it("POST /auth/logout-all bumps tokenVersion + revokes caller's token", async () => {
    const u = await makeUser();

    const before = await prisma.user.findUnique({ where: { id: u.id } });
    const beforeV = before!.tokenVersion;

    const res = await request(app)
      .post("/api/v1/auth/logout-all")
      .set("Authorization", `Bearer ${u.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.tokenVersion).toBe(beforeV + 1);

    // The caller's original token is now at an older version — next
    // request must 401.
    const followUp = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${u.token}`);
    expect(followUp.status).toBe(401);
    expect(followUp.body.error?.code).toBe("TOKEN_REVOKED");
  });

  it("deleted user's token gets 401", async () => {
    const u = await makeUser();
    // Hard-delete the user. The middleware's getTokenVersion returns
    // null for missing users, which the version check treats as
    // revoked. (In production we don't hard-delete users, but the
    // path must still fail closed.)
    await prisma.user.delete({ where: { id: u.id } });

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${u.token}`);
    expect(res.status).toBe(401);
  });

  it("PATCH /me role change bumps tokenVersion and returns fresh token", async () => {
    const u = await makeUser({ role: "resident" });

    const res = await request(app)
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${u.token}`)
      .send({ role: "volunteer" });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("volunteer");
    // A fresh token is included on role change.
    expect(res.body.token).toBeDefined();

    // DB tokenVersion should have incremented.
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after!.tokenVersion).toBeGreaterThan(0);

    // Fresh token works.
    const freshCheck = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${res.body.token}`);
    expect(freshCheck.status).toBe(200);

    // Old token is now revoked.
    const oldCheck = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${u.token}`);
    expect(oldCheck.status).toBe(401);
  });
});
