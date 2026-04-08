// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import { registry } from "../lib/metrics.js";

const router = Router();

router.get("/metrics", async (_req, res) => {
  res.set("Content-Type", registry.contentType);
  res.end(await registry.metrics());
});

export default router;
