// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import { prisma } from "@samur/db";
import { ConsentRecordSchema } from "@samur/shared";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { getConsentVersion } from "../lib/consentVersion.js";
import { getMyConsentState, invalidateDistributionConsentCache } from "../lib/consent.js";
import { getRealIp } from "../lib/clientIp.js";
import { logger } from "../lib/logger.js";

const router = Router();

/**
 * GET /api/v1/consent/version  (public)
 *
 * Returns the current consent version (16-char prefix of the SHA-256
 * of legal/privacy-policy.md). The PWA reads this on app start to
 * decide whether already-recorded consent is still current — if the
 * stored version differs from the current one, the ConsentGate
 * re-prompts the user with the new text.
 */
router.get("/version", (_req, res) => {
  res.json({ success: true, data: { version: getConsentVersion() } });
});

/**
 * GET /api/v1/consent/me  (authenticated)
 *
 * Returns the latest consent state for both consent types, plus the
 * current version. ConsentGate uses this to decide whether to prompt.
 */
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const state = await getMyConsentState(req.user!.sub);
    res.json({
      success: true,
      data: { ...state, currentVersion: getConsentVersion() },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/consent  (authenticated)
 * Body: { type: "processing" | "distribution", accepted: boolean }
 *
 * Used by the in-session ConsentGate (existing users on first login
 * post-deploy who never granted consent at registration). Append-only
 * — every call writes a new ConsentLog row.
 */
router.post(
  "/",
  requireAuth,
  validateBody(ConsentRecordSchema),
  async (req, res, next) => {
    try {
      const { type, accepted } = req.body;
      const ip = getRealIp(req);
      const ua = req.headers["user-agent"];
      await prisma.consentLog.create({
        data: {
          userId: req.user!.sub,
          consentType: type,
          consentVersion: getConsentVersion(),
          accepted,
          ipAddress: ip === "unknown" ? null : ip,
          userAgent: typeof ua === "string" ? ua.slice(0, 500) : null,
        },
      });
      if (type === "distribution") {
        invalidateDistributionConsentCache();
      }
      logger.info({ userId: req.user!.sub, type, accepted }, "Consent recorded");
      res.json({ success: true, data: { recorded: true } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
