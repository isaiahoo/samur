// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("7d"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  VK_SECRET: z.string().default(""),
  VK_APP_ID: z.string().default(""),
  WEBHOOK_API_KEY: z.string().default(""),
  TG_BOT_TOKEN: z.string().default(""),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("debug"),
  MAPTILER_API_KEY: z.string().default(""),
  TILE_PROVIDER: z.enum(["maptiler", "openfreemap"]).default("maptiler"),
});

/**
 * Production-time refinement: enforce stricter defaults.
 * Called after initial parse to warn / override for production safety.
 */
function refineForProduction(cfg: z.infer<typeof envSchema>): z.infer<typeof envSchema> {
  if (cfg.NODE_ENV !== "production") return cfg;

  // Enforce minimum log level in production (no debug/trace noise)
  if (cfg.LOG_LEVEL === "debug" || cfg.LOG_LEVEL === "trace") {
    process.stderr.write(`[config] LOG_LEVEL "${cfg.LOG_LEVEL}" overridden to "info" in production\n`);
    cfg.LOG_LEVEL = "info";
    process.env.LOG_LEVEL = "info"; // propagate to logger (reads process.env directly)
  }

  // Require WEBHOOK_API_KEY in production
  if (cfg.WEBHOOK_API_KEY.length < 16) {
    process.stderr.write("[config] WARNING: WEBHOOK_API_KEY is too short (<16 chars) for production\n");
  }

  return cfg;
}

function loadConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    // Logger not yet available at config time — use stderr directly
    process.stderr.write("Invalid environment variables:\n");
    process.stderr.write(JSON.stringify(result.error.format(), null, 2) + "\n");
    process.exit(1);
  }
  return refineForProduction(result.data);
}

export const config = loadConfig();
export type Config = z.infer<typeof envSchema>;
