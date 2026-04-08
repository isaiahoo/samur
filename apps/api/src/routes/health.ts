// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import { prisma } from "@samur/db";

const router = Router();
const startedAt = Date.now();

router.get("/health", async (_req, res) => {
  let dbStatus = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = "unreachable";
  }

  const uptimeMs = Date.now() - startedAt;
  const uptimeSec = Math.floor(uptimeMs / 1000);

  res.json({
    success: true,
    data: {
      status: dbStatus === "ok" ? "healthy" : "degraded",
      uptime: `${uptimeSec}s`,
      database: dbStatus,
      timestamp: new Date().toISOString(),
    },
  });
});

export default router;
