// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import { prisma, Prisma } from "@samur/db";
import { validateQuery } from "../middleware/validate.js";
import { NewsArticleQuerySchema } from "@samur/shared";
import { NEWS_FEEDS } from "../services/newsFeeds.js";

const router = Router();

// ── GET / — list news articles (paginated, filterable) ──────────────────

router.get(
  "/",
  validateQuery(NewsArticleQuerySchema),
  async (req, res, next) => {
    try {
      const q = (req as unknown as { parsedQuery: Record<string, unknown> }).parsedQuery as {
        page: number;
        limit: number;
        feedId?: string;
        category?: string;
        sort: string;
        order: string;
      };

      const where: Prisma.NewsArticleWhereInput = { deletedAt: null };
      if (q.feedId) where.feedId = q.feedId;
      if (q.category) where.category = { contains: q.category, mode: "insensitive" };

      const orderBy: Prisma.NewsArticleOrderByWithRelationInput =
        q.sort === "fetched_at"
          ? { fetchedAt: q.order as Prisma.SortOrder }
          : { publishedAt: q.order as Prisma.SortOrder };

      const [items, total] = await Promise.all([
        prisma.newsArticle.findMany({
          where,
          orderBy,
          skip: (q.page - 1) * q.limit,
          take: q.limit,
          select: {
            id: true,
            feedId: true,
            title: true,
            summary: true,
            url: true,
            imageUrl: true,
            category: true,
            publishedAt: true,
            fetchedAt: true,
          },
        }),
        prisma.newsArticle.count({ where }),
      ]);

      res.json({
        success: true,
        data: items,
        meta: { total, page: q.page, limit: q.limit },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /feeds — list configured feeds ──────────────────────────────────

router.get("/feeds", (_req, res) => {
  res.json({
    success: true,
    data: NEWS_FEEDS.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      priority: f.priority,
      enabled: f.enabled,
    })),
  });
});

// ── GET /:id — single article ───────────────────────────────────────────

router.get("/:id", async (req, res, next) => {
  try {
    const article = await prisma.newsArticle.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });

    if (!article) {
      res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Статья не найдена" },
      });
      return;
    }

    res.json({ success: true, data: article });
  } catch (err) {
    next(err);
  }
});

export default router;
