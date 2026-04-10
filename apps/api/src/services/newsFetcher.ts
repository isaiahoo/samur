// SPDX-License-Identifier: AGPL-3.0-only

import RSSParser from "rss-parser";
import { prisma } from "@samur/db";
import { logger } from "../lib/logger.js";
import { NEWS_FEEDS } from "./newsFeeds.js";
import type { NewsFeed } from "./newsFeeds.js";

const log = logger.child({ service: "news-fetcher" });

const parser = new RSSParser({
  timeout: 30_000,
  headers: {
    "User-Agent": "Samur-FloodMonitor/1.0 (flood relief platform)",
    Accept: "application/rss+xml, application/xml, text/xml",
    "Accept-Encoding": "identity", // avoid gzip — some feeds return compressed with wrong content-type
  },
});

// Track last fetch time per feed to respect intervalMinutes
const lastFetchTime = new Map<string, number>();

// ── Helpers ──────────────────────────────────────────────────────────────

/** Strip HTML tags and decode common entities */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Truncate to maxLen chars at word boundary */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.lastIndexOf(" ", maxLen);
  return text.slice(0, cut > 0 ? cut : maxLen) + "...";
}

/** Check if text matches any keyword (case-insensitive substring) */
function matchesKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

/** Extract first image URL from HTML content */
function extractImageUrl(html: string | undefined): string | null {
  if (!html) return null;
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (match?.[1] && match[1].startsWith("http")) return match[1];
  // Also check for enclosure/media
  const enclosure = html.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
  return enclosure?.[1] ?? null;
}

// ── Feed processing ─────────────────────────────────────────────────────

async function fetchFeed(feed: NewsFeed): Promise<number> {
  let stored = 0;

  try {
    const result = await parser.parseURL(feed.url);

    if (!result.items || result.items.length === 0) {
      log.debug({ feedId: feed.id }, "Feed returned no items");
      return 0;
    }

    for (const item of result.items) {
      // Must have a title and link
      if (!item.title || !item.link) continue;

      // Dedup key: prefer guid, fall back to link
      const externalId = item.guid || item.link;

      // Category filtering
      if (feed.categoryFilter && feed.categoryFilter.length > 0) {
        const itemCategories = (
          Array.isArray(item.categories) ? item.categories.join(" ") : ""
        ).toLowerCase();
        const titleAndContent = `${item.title} ${item.contentSnippet ?? ""}`.toLowerCase();

        const categoryMatch = feed.categoryFilter.some(
          (cat) =>
            itemCategories.includes(cat.toLowerCase()) ||
            titleAndContent.includes(cat.toLowerCase()),
        );

        // If category filter set but no match, check keyword filter as fallback
        if (!categoryMatch && (!feed.keywordFilter || feed.keywordFilter.length === 0)) {
          continue;
        }

        // If neither category nor keyword match, skip
        if (
          !categoryMatch &&
          feed.keywordFilter &&
          !matchesKeywords(`${item.title} ${item.contentSnippet ?? ""}`, feed.keywordFilter)
        ) {
          continue;
        }
      } else if (feed.keywordFilter && feed.keywordFilter.length > 0) {
        // Keyword-only filtering
        if (!matchesKeywords(`${item.title} ${item.contentSnippet ?? ""}`, feed.keywordFilter)) {
          continue;
        }
      }

      // Exclusion filter — reject articles matching any exclude keyword
      if (feed.excludeKeywords && feed.excludeKeywords.length > 0) {
        if (matchesKeywords(`${item.title} ${item.contentSnippet ?? ""}`, feed.excludeKeywords)) {
          continue;
        }
      }

      // Parse date
      const publishedAt = item.pubDate
        ? new Date(item.pubDate)
        : item.isoDate
          ? new Date(item.isoDate)
          : new Date();

      if (isNaN(publishedAt.getTime())) continue;

      // Build summary from content snippet or description
      const rawSummary = item.contentSnippet || item.content || item.summary || "";
      const summary = truncate(stripHtml(rawSummary), 500) || null;

      // Extract category
      const category = Array.isArray(item.categories) && item.categories.length > 0
        ? item.categories[0]
        : null;

      // Extract image: try enclosure first (RIA Dagestan), then HTML content (Interfax)
      const enclosure = item.enclosure as { url?: string; type?: string } | undefined;
      const enclosureUrl = enclosure?.url && enclosure.url.startsWith("http") ? enclosure.url : null;
      const imageUrl = enclosureUrl
        ?? extractImageUrl(item.content || item["content:encoded"])
        ?? null;

      // Upsert — skip if already exists (unique constraint on feedId + externalId)
      try {
        await prisma.newsArticle.upsert({
          where: {
            feedId_externalId: { feedId: feed.id, externalId },
          },
          create: {
            feedId: feed.id,
            externalId,
            title: item.title.trim(),
            summary,
            body: null, // full body not stored for now to save space
            url: item.link,
            imageUrl,
            category,
            publishedAt,
          },
          update: {
            title: item.title.trim(),
            summary,
            imageUrl,
          },
        });
        stored++;
      } catch (err: unknown) {
        // Prisma P2002 = unique constraint violation, safe to ignore
        if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
          continue;
        }
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ feedId: feed.id, externalId, error: msg }, "Failed to store article");
      }
    }

    log.info(
      { feedId: feed.id, feedName: feed.name, items: result.items.length, stored },
      "Feed processed",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ feedId: feed.id, url: feed.url, error: msg }, "Failed to fetch feed");
  }

  return stored;
}

// ── Main entry point ────────────────────────────────────────────────────

export interface NewsFetchStats {
  feeds: number;
  articles: number;
  duration: number;
}

/**
 * Fetch all enabled news feeds, respecting per-feed interval.
 * Call this frequently (e.g. every 15 min); it will skip feeds
 * that were fetched recently based on their intervalMinutes.
 */
export async function fetchAllNewsFeeds(): Promise<NewsFetchStats> {
  const start = Date.now();
  let totalArticles = 0;
  let feedsProcessed = 0;

  const enabledFeeds = NEWS_FEEDS.filter((f) => f.enabled);

  for (const feed of enabledFeeds) {
    // Respect per-feed interval
    const lastFetch = lastFetchTime.get(feed.id) ?? 0;
    const elapsed = Date.now() - lastFetch;
    if (elapsed < feed.intervalMinutes * 60 * 1000) {
      log.debug({ feedId: feed.id, nextIn: Math.round((feed.intervalMinutes * 60 * 1000 - elapsed) / 1000) }, "Skipping — too soon");
      continue;
    }

    const stored = await fetchFeed(feed);
    totalArticles += stored;
    feedsProcessed++;
    lastFetchTime.set(feed.id, Date.now());

    // Polite delay between feeds
    await new Promise((r) => setTimeout(r, 2000));
  }

  const duration = Date.now() - start;

  if (feedsProcessed > 0) {
    log.info(
      { feeds: feedsProcessed, articles: totalArticles, durationMs: duration },
      `News fetch complete: ${feedsProcessed} feeds, ${totalArticles} articles`,
    );
  }

  return { feeds: feedsProcessed, articles: totalArticles, duration };
}
