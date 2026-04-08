// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("7d"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  VK_SECRET: z.string().default(""),
  VK_APP_ID: z.string().default(""),
  LOG_LEVEL: z.string().default("debug"),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Invalid environment variables:");
    console.error(result.error.format());
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
export type Config = z.infer<typeof envSchema>;
