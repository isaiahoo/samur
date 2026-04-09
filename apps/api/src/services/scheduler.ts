// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "../lib/logger.js";
import { scrapeAllStations, seedGaugeStations } from "./riverScraper.js";
import { fetchAllNewsFeeds } from "./newsFetcher.js";
import { fetchPrecipitationGrid, isCacheStale } from "./precipitationClient.js";
import { fetchSoilMoistureGrid, isSoilMoistureCacheStale } from "./soilMoistureClient.js";
import { fetchSnowGrid, isSnowCacheStale } from "./snowClient.js";
import { computeRunoffGrid } from "./runoffClient.js";
import { fetchEarthquakes, isEarthquakeCacheStale, cleanupOldEarthquakes } from "./earthquakeClient.js";

const log = logger.child({ service: "scheduler" });

const SCRAPE_INTERVAL_MS = 60 * 60 * 1000;        // 1 hour
const NEWS_INTERVAL_MS = 15 * 60 * 1000;          // 15 minutes
const PRECIP_INTERVAL_MS = 2 * 60 * 60 * 1000;    // 2 hours — more frequent for flood events
const WEATHER_INTERVAL_MS = 6 * 60 * 60 * 1000;   // 6 hours — soil moisture + snow
const EARTHQUAKE_INTERVAL_MS = 5 * 60 * 1000;     // 5 minutes — seismic events are time-critical

let scrapeTimer: ReturnType<typeof setInterval> | null = null;
let newsTimer: ReturnType<typeof setInterval> | null = null;
let precipTimer: ReturnType<typeof setInterval> | null = null;
let soilMoistureTimer: ReturnType<typeof setInterval> | null = null;
let snowTimer: ReturnType<typeof setInterval> | null = null;
let earthquakeTimer: ReturnType<typeof setInterval> | null = null;
let eqCleanupTimer: ReturnType<typeof setInterval> | null = null;
const initialTimeouts: ReturnType<typeof setTimeout>[] = [];
let isRunning = false;
let isNewsFetching = false;
let isPrecipFetching = false;
let isSoilMoistureFetching = false;
let isSnowFetching = false;
let isEarthquakeFetching = false;

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

async function runPrecipFetch(): Promise<void> {
  if (isPrecipFetching) return;
  if (!isCacheStale()) return; // skip if cache is fresh

  isPrecipFetching = true;
  try {
    const data = await fetchPrecipitationGrid();
    log.info({ points: data.length }, "Precipitation grid updated");
    // Recompute runoff (derived from precip + soil moisture)
    computeRunoffGrid();
  } catch (err) {
    log.error({ err }, "Precipitation fetch failed");
  } finally {
    isPrecipFetching = false;
  }
}

async function runSoilMoistureFetch(): Promise<void> {
  if (isSoilMoistureFetching) return;
  if (!isSoilMoistureCacheStale()) return;

  isSoilMoistureFetching = true;
  try {
    const data = await fetchSoilMoistureGrid();
    log.info({ points: data.length }, "Soil moisture grid updated");
    // Recompute runoff (derived from precip + soil moisture)
    computeRunoffGrid();
  } catch (err) {
    log.error({ err }, "Soil moisture fetch failed");
  } finally {
    isSoilMoistureFetching = false;
  }
}

async function runSnowFetch(): Promise<void> {
  if (isSnowFetching) return;
  if (!isSnowCacheStale()) return;

  isSnowFetching = true;
  try {
    const data = await fetchSnowGrid();
    log.info({ points: data.length }, "Snow grid updated");
  } catch (err) {
    log.error({ err }, "Snow fetch failed");
  } finally {
    isSnowFetching = false;
  }
}

async function runEarthquakeFetch(): Promise<void> {
  if (isEarthquakeFetching) return;
  if (!isEarthquakeCacheStale()) return;

  isEarthquakeFetching = true;
  try {
    const data = await fetchEarthquakes();
    log.info({ events: data.length }, "Earthquake data updated");
  } catch (err) {
    log.error({ err }, "Earthquake fetch failed");
  } finally {
    isEarthquakeFetching = false;
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

  // Run first fetches after staggered delays (let the API finish starting)
  initialTimeouts.push(
    setTimeout(() => { runScrape(); }, 10_000),
    setTimeout(() => { runNewsFetch(); }, 15_000),
    setTimeout(() => { runPrecipFetch(); }, 20_000),
    setTimeout(() => { runSoilMoistureFetch(); }, 25_000),
    setTimeout(() => { runSnowFetch(); }, 30_000),
    setTimeout(() => { computeRunoffGrid(); }, 35_000),
    setTimeout(() => { runEarthquakeFetch(); }, 40_000),
  );

  // Schedule hourly scrapes
  scrapeTimer = setInterval(runScrape, SCRAPE_INTERVAL_MS);
  log.info({ intervalMs: SCRAPE_INTERVAL_MS }, "Scrape scheduler started");

  // Schedule news fetches every 15 minutes
  newsTimer = setInterval(runNewsFetch, NEWS_INTERVAL_MS);
  log.info({ intervalMs: NEWS_INTERVAL_MS }, "News fetch scheduler started");

  // Schedule precipitation fetches every 2 hours (more frequent for flood events)
  precipTimer = setInterval(runPrecipFetch, PRECIP_INTERVAL_MS);
  log.info({ intervalMs: PRECIP_INTERVAL_MS }, "Precipitation scheduler started");

  // Schedule soil moisture fetches every 6 hours
  soilMoistureTimer = setInterval(runSoilMoistureFetch, WEATHER_INTERVAL_MS);
  log.info({ intervalMs: WEATHER_INTERVAL_MS }, "Soil moisture scheduler started");

  // Schedule snow fetches every 6 hours
  snowTimer = setInterval(runSnowFetch, WEATHER_INTERVAL_MS);
  log.info({ intervalMs: WEATHER_INTERVAL_MS }, "Snow scheduler started");

  // Schedule earthquake fetches every 5 minutes
  earthquakeTimer = setInterval(runEarthquakeFetch, EARTHQUAKE_INTERVAL_MS);
  log.info({ intervalMs: EARTHQUAKE_INTERVAL_MS }, "Earthquake scheduler started");

  // Cleanup old earthquake records daily
  eqCleanupTimer = setInterval(() => { cleanupOldEarthquakes(); }, 24 * 60 * 60 * 1000);
}

export function stopScheduler(): void {
  for (const t of initialTimeouts) clearTimeout(t);
  initialTimeouts.length = 0;
  if (scrapeTimer) {
    clearInterval(scrapeTimer);
    scrapeTimer = null;
  }
  if (newsTimer) {
    clearInterval(newsTimer);
    newsTimer = null;
  }
  if (precipTimer) {
    clearInterval(precipTimer);
    precipTimer = null;
  }
  if (soilMoistureTimer) {
    clearInterval(soilMoistureTimer);
    soilMoistureTimer = null;
  }
  if (snowTimer) {
    clearInterval(snowTimer);
    snowTimer = null;
  }
  if (earthquakeTimer) {
    clearInterval(earthquakeTimer);
    earthquakeTimer = null;
  }
  if (eqCleanupTimer) {
    clearInterval(eqCleanupTimer);
    eqCleanupTimer = null;
  }
  log.info("Schedulers stopped");
}
