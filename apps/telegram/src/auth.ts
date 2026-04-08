// SPDX-License-Identifier: AGPL-3.0-only
import { findOrCreateTelegramUser, loginTelegramUser } from "./api.js";

// Cache JWT tokens by chatId to avoid re-authenticating every request
const tokenCache = new Map<number, { token: string; expiresAt: number }>();
const TOKEN_TTL_MS = 6 * 3600_000; // refresh every 6 hours

export async function getToken(
  chatId: number,
  tgId: number,
  name: string,
): Promise<string> {
  const cached = tokenCache.get(chatId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const tgIdStr = String(tgId);

  // Try login first, register if not found
  let result = await loginTelegramUser(tgIdStr);
  if (!result) {
    result = await findOrCreateTelegramUser(tgIdStr, name);
  }

  tokenCache.set(chatId, {
    token: result.token,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });
  return result.token;
}
