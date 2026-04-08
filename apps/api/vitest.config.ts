import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 15000,
    hookTimeout: 15000,
    include: ["tests/**/*.test.ts"],
    env: {
      DATABASE_URL: "postgresql://samur:samur_dev@localhost:5432/samur_test?schema=public",
      JWT_SECRET: "test-secret-min-16-chars!!",
      REDIS_URL: "redis://localhost:6379",
      NODE_ENV: "test",
    },
  },
});
