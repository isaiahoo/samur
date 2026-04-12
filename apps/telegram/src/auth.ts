// SPDX-License-Identifier: AGPL-3.0-only
import { authenticateForPWA } from "./api.js";

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

  // Authenticate via Telegram HMAC (same as PWA login widget)
  const nameParts = name.split(" ");
  const firstName = nameParts[0] || "Пользователь";
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined;
  const result = await authenticateForPWA(tgId, firstName, lastName);

  tokenCache.set(chatId, {
    token: result.token,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });
  return result.token;
}
