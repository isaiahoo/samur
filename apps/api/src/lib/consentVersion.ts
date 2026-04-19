// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { logger } from "./logger.js";

/**
 * 152-ФЗ consent versioning.
 *
 * Every ConsentLog row stores the version of the policy text the user
 * actually saw at the moment of acceptance. We derive it deterministically
 * from a SHA-256 of legal/privacy-policy.md so an edit to the policy
 * automatically invalidates prior consent (older rows still prove what
 * was seen, but downstream code can compare current vs stored version).
 *
 * The full hash is overkill for human display; we expose a 16-char prefix
 * which still has 64 bits of collision resistance — enough for an audit
 * trail given we control writes.
 *
 * Resolved at module import time. If the file is missing (it must be
 * copied into the container — see Dockerfile), we log a warning and fall
 * back to "INITIAL" so the API still boots and the rest of the app is
 * usable while the issue is fixed. Real consent writes during that
 * window are still recorded; the version field just won't be tied to
 * the actual text.
 */

const POLICY_CANDIDATES = [
  "/app/legal/privacy-policy.md",
  join(process.cwd(), "legal", "privacy-policy.md"),
  join(process.cwd(), "..", "..", "legal", "privacy-policy.md"),
];

function loadVersion(): string {
  for (const path of POLICY_CANDIDATES) {
    try {
      const raw = readFileSync(path, "utf-8");
      const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
      logger.info({ path, version: hash }, "Loaded privacy policy version");
      return hash;
    } catch {
      /* try next */
    }
  }
  logger.warn({ candidates: POLICY_CANDIDATES }, "privacy-policy.md not found — falling back to INITIAL version");
  return "INITIAL";
}

const CONSENT_VERSION = loadVersion();

export function getConsentVersion(): string {
  return CONSENT_VERSION;
}
