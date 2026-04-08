// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "../lib/logger.js";
import { scrapeAllStations, seedGaugeStations } from "./riverScraper.js";
import { fetchAllNewsFeeds } from "./newsFetcher.js";

const log = logger.child({ service: "scheduler" });

const SCRAPE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const NEWS_INTERVAL_MS = 15 * 60 * 1000;   // 15 minutes

let scrapeTimer: ReturnType<typeof setInterval> | null = null;
let newsTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let isNewsFetching = false;

async function runScrape(): Promise<void> {
  if (isRunning) {
    log.warn("Scrape already in progress, skipping");
    return;
  }

  isRunning = true;
  try {
    const stats = await scrapeAllStations();
    log.info(
      { scraped: stats.scraped, failed: stats.failed, durationMs: stats.duration },
      "Scheduled scrape completed",
    );
  } catch (err) {
    log.error({ err }, "Scheduled scrape failed");
  } finally {
    isRunning = false;
  }
}

async function runNewsFetch(): Promise<void> {
  if (isNewsFetching) {
    log.warn("News fetch already in progress, skipping");
    return;
  }

  isNewsFetching = true;
  try {
    const stats = await fetchAllNewsFeeds();
    if (stats.feeds > 0) {
      log.info(
        { feeds: stats.feeds, articles: stats.articles, durationMs: stats.duration },
        "Scheduled news fetch completed",
      );
    }
  } catch (err) {
    log.error({ err }, "Scheduled news fetch failed");
  } finally {
    isNewsFetching = false;
  }
}

/**
 * Start the river level scraping scheduler and news feed fetcher.
 * Seeds gauge stations on first run, then scrapes every hour.
 * News feeds are fetched every 15 minutes.
 */
export async function startScheduler(): Promise<void> {
  log.info("Starting river level scheduler");

  // Seed gauge stations so they appear on map immediately
  try {
    const seeded = await seedGaugeStations();
    if (seeded > 0) {
      log.info({ seeded }, "Gauge stations seeded");
    }
  } catch (err) {
    log.error({ err }, "Failed to seed gauge stations");
  }

  // Run first scrape after a short delay (let the API finish starting)
  setTimeout(() => {
    runScrape();
  }, 10_000);

  // Run first news fetch after 15 seconds
  setTimeout(() => {
    runNewsFetch();
  }, 15_000);

  // Schedule hourly scrapes
  scrapeTimer = setInterval(runScrape, SCRAPE_INTERVAL_MS);
  log.info({ intervalMs: SCRAPE_INTERVAL_MS }, "Scrape scheduler started");

  // Schedule news fetches every 15 minutes
  newsTimer = setInterval(runNewsFetch, NEWS_INTERVAL_MS);
  log.info({ intervalMs: NEWS_INTERVAL_MS }, "News fetch scheduler started");
}

export function stopScheduler(): void {
  if (scrapeTimer) {
    clearInterval(scrapeTimer);
    scrapeTimer = null;
  }
  if (newsTimer) {
    clearInterval(newsTimer);
    newsTimer = null;
  }
  log.info("Schedulers stopped");
}
