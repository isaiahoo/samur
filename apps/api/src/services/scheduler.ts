// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "../lib/logger.js";
import { scrapeAllStations, seedGaugeStations } from "./riverScraper.js";

const log = logger.child({ service: "scheduler" });

const SCRAPE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let scrapeTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

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

/**
 * Start the river level scraping scheduler.
 * Seeds gauge stations on first run, then scrapes every hour.
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

  // Schedule hourly scrapes
  scrapeTimer = setInterval(runScrape, SCRAPE_INTERVAL_MS);
  log.info({ intervalMs: SCRAPE_INTERVAL_MS }, "Scrape scheduler started");
}

export function stopScheduler(): void {
  if (scrapeTimer) {
    clearInterval(scrapeTimer);
    scrapeTimer = null;
    log.info("Scrape scheduler stopped");
  }
}
