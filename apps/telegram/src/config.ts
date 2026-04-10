// SPDX-License-Identifier: AGPL-3.0-only

export const config = {
  TG_BOT_TOKEN: requireEnv("TG_BOT_TOKEN"),
  API_BASE_URL: process.env.API_BASE_URL ?? "http://localhost:3000",
  API_INTERNAL_TOKEN: process.env.API_INTERNAL_TOKEN ?? "",
  SOCKET_URL: process.env.SOCKET_URL ?? "http://localhost:3000",
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  MAX_REPORTS_PER_HOUR: Number(process.env.MAX_REPORTS_PER_HOUR) || 5,
  STATE_TTL_SEC: Number(process.env.STATE_TTL_SEC) || 600,
};

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return val;
}
