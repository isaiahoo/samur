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
  GREENSMS_TOKEN: z.string().default(""),
  // Yandex Object Storage — when these are all set we route uploads
  // through S3 instead of the local filesystem. Leaving them empty
  // falls back to local fs + express.static, which is what dev and
  // the test suite rely on. See lib/storage.ts for the dispatch.
  YANDEX_STORAGE_ENDPOINT: z.string().default(""),
  YANDEX_STORAGE_REGION: z.string().default("ru-central1"),
  YANDEX_STORAGE_BUCKET: z.string().default(""),
  YANDEX_STORAGE_ACCESS_KEY_ID: z.string().default(""),
  YANDEX_STORAGE_SECRET_ACCESS_KEY: z.string().default(""),
  YANDEX_STORAGE_PUBLIC_URL: z.string().default(""),
}).superRefine((cfg, ctx) => {
  // Hard-fail at startup when a production deployment is missing a
  // required secret. Previously these were warn-only and the app kept
  // running — an empty WEBHOOK_API_KEY in production caused every
  // webhook call to 500 silently, and you'd only notice when the SMS
  // gateway started dropping incident reports. Fail fast instead so
  // the deploy itself catches the misconfig.
  if (cfg.NODE_ENV !== "production") return;
  if (cfg.WEBHOOK_API_KEY.length < 16) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["WEBHOOK_API_KEY"],
      message: "WEBHOOK_API_KEY must be set and ≥16 characters in production",
    });
  }
});

/**
 * Production-time refinement: apply stricter runtime defaults that
 * don't warrant hard-failing the boot (e.g. log-level sanitization).
 * Hard-fail concerns (missing secrets) are enforced via the schema's
 * superRefine above.
 */
function refineForProduction(cfg: z.infer<typeof envSchema>): z.infer<typeof envSchema> {
  if (cfg.NODE_ENV !== "production") return cfg;

  // Enforce minimum log level in production (no debug/trace noise)
  if (cfg.LOG_LEVEL === "debug" || cfg.LOG_LEVEL === "trace") {
    process.stderr.write(`[config] LOG_LEVEL "${cfg.LOG_LEVEL}" overridden to "info" in production\n`);
    cfg.LOG_LEVEL = "info";
    process.env.LOG_LEVEL = "info"; // propagate to logger (reads process.env directly)
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
