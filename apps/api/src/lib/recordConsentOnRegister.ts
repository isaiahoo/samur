// SPDX-License-Identifier: AGPL-3.0-only
import type { Request } from "express";
import { prisma } from "@samur/db";
import type { ConsentInput } from "@samur/shared";
import { AppError } from "../middleware/error.js";
import { getConsentVersion } from "./consentVersion.js";
import { getRealIp } from "./clientIp.js";
import { invalidateDistributionConsentCache } from "./consent.js";

/**
 * Validates the registration-time consent payload and writes a
 * ConsentLog row for each consent type. Throws 400 if processing
 * consent is missing or false (152-ФЗ ст. 6 — required).
 *
 * Must be called within the same transaction as the user.create when
 * possible — accept a Prisma client variant to support both.
 */
export async function recordConsentOnRegister(
  req: Request,
  userId: string,
  consent: ConsentInput | undefined,
  client: typeof prisma = prisma,
): Promise<void> {
  if (!consent || consent.processing !== true) {
    throw new AppError(
      400,
      "CONSENT_REQUIRED",
      "Для регистрации необходимо согласие на обработку персональных данных",
    );
  }
  const version = getConsentVersion();
  const ip = getRealIp(req);
  const ua = req.headers["user-agent"];
  const ipValue = ip === "unknown" ? null : ip;
  const uaValue = typeof ua === "string" ? ua.slice(0, 500) : null;

  await client.consentLog.createMany({
    data: [
      {
        userId,
        consentType: "processing",
        consentVersion: version,
        accepted: true,
        ipAddress: ipValue,
        userAgent: uaValue,
      },
      {
        userId,
        consentType: "distribution",
        consentVersion: version,
        accepted: consent.distribution === true,
        ipAddress: ipValue,
        userAgent: uaValue,
      },
    ],
  });
  if (consent.distribution === true) {
    invalidateDistributionConsentCache();
  }
}
