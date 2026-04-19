// SPDX-License-Identifier: AGPL-3.0-only
import { prisma } from "@samur/db";

/**
 * Returns the current state of both consents for one user, derived
 * from the latest ConsentLog row per type. Used by the ConsentGate
 * (existing-user gate on first login post-deploy) to decide whether
 * to prompt.
 *
 * Distribution is folded into the same UX as processing — the policy
 * text covers both — but we still record both rows for an audit trail
 * that lets us re-introduce the differentiation later without losing
 * historical evidence.
 */
export async function getMyConsentState(userId: string): Promise<{
  processing: { accepted: boolean; at: string; version: string } | null;
  distribution: { accepted: boolean; at: string; version: string } | null;
}> {
  const rows = await prisma.consentLog.findMany({
    where: { userId },
    orderBy: { acceptedAt: "desc" },
  });
  const latestByType = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    if (!latestByType.has(row.consentType)) {
      latestByType.set(row.consentType, row);
    }
  }
  const proc = latestByType.get("processing");
  const dist = latestByType.get("distribution");
  return {
    processing: proc
      ? { accepted: proc.accepted, at: proc.acceptedAt.toISOString(), version: proc.consentVersion }
      : null,
    distribution: dist
      ? { accepted: dist.accepted, at: dist.acceptedAt.toISOString(), version: dist.consentVersion }
      : null,
  };
}
