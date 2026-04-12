// SPDX-License-Identifier: AGPL-3.0-only

import { Redis } from "ioredis";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { scrapeAllStations, seedGaugeStations } from "./riverScraper.js";
import { fetchAllNewsFeeds } from "./newsFetcher.js";
import { fetchPrecipitationGrid, isCacheStale } from "./precipitationClient.js";
import { fetchSoilMoistureGrid, isSoilMoistureCacheStale } from "./soilMoistureClient.js";
import { fetchSnowGrid, isSnowCacheStale } from "./snowClient.js";
import { computeRunoffGrid } from "./runoffClient.js";
import { fetchEarthquakes, isEarthquakeCacheStale, cleanupOldEarthquakes } from "./earthquakeClient.js";
import { fetchAndStorePredictions } from "./mlClient.js";

const log = logger.child({ service: "scheduler" });

let lockRedis: Redis | null = null;

/** Task timeout: 5 minutes max per task */
const TASK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Acquire a distributed lock via Redis SET NX EX.
 * Returns true if lock acquired, false if another instance holds it.
 */
async function acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
  if (!lockRedis) return true; // No Redis → single-instance mode, allow execution
  const result = await lockRedis.set(`scheduler:${key}`, process.pid.toString(), "EX", ttlSeconds, "NX");
  return result === "OK";
}

async function releaseLock(key: string): Promise<void> {
  if (!lockRedis) return;
  await lockRedis.del(`scheduler:${key}`).catch(() => {});
}

/** Wrap a task with distributed lock + timeout */
async function withLock<T>(name: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T | undefined> {
  if (!(await acquireLock(name, ttlSeconds))) {
    log.debug({ task: name }, "Lock held by another instance, skipping");
    return undefined;
  }
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Task ${name} timed out after ${TASK_TIMEOUT_MS}ms`)), TASK_TIMEOUT_MS),
      ),
    ]);
  } finally {
    await releaseLock(name);
  }
}

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
async function runScrape(): Promise<void> {
  await withLock("scrape", 600, async () => {
    const stats = await scrapeAllStations();
    log.info(
      { scraped: stats.scraped, failed: stats.failed, durationMs: stats.duration },
      "Scheduled scrape completed",
    );
  }).catch((err) => log.error({ err }, "Scheduled scrape failed"));
}

async function runNewsFetch(): Promise<void> {
  await withLock("news", 300, async () => {
    const stats = await fetchAllNewsFeeds();
    if (stats.feeds > 0) {
      log.info(
        { feeds: stats.feeds, articles: stats.articles, durationMs: stats.duration },
        "Scheduled news fetch completed",
      );
    }
  }).catch((err) => log.error({ err }, "Scheduled news fetch failed"));
}

async function runPrecipFetch(): Promise<void> {
  if (!isCacheStale()) return;
  await withLock("precip", 300, async () => {
    const data = await fetchPrecipitationGrid();
    log.info({ points: data.length }, "Precipitation grid updated");
    computeRunoffGrid();
  }).catch((err) => log.error({ err }, "Precipitation fetch failed"));
}

async function runSoilMoistureFetch(): Promise<void> {
  if (!isSoilMoistureCacheStale()) return;
  await withLock("soil-moisture", 300, async () => {
    const data = await fetchSoilMoistureGrid();
    log.info({ points: data.length }, "Soil moisture grid updated");
    computeRunoffGrid();
  }).catch((err) => log.error({ err }, "Soil moisture fetch failed"));
}

async function runSnowFetch(): Promise<void> {
  if (!isSnowCacheStale()) return;
  await withLock("snow", 300, async () => {
    const data = await fetchSnowGrid();
    log.info({ points: data.length }, "Snow grid updated");
  }).catch((err) => log.error({ err }, "Snow fetch failed"));
}

async function runMlPredict(): Promise<void> {
  await withLock("ml-predict", 300, async () => {
    const result = await fetchAndStorePredictions();
    log.info({ stored: result.stored, errors: result.errors.length }, "ML predictions updated");
  }).catch((err) => log.error({ err }, "ML prediction failed"));
}

async function runEarthquakeFetch(): Promise<void> {
  if (!isEarthquakeCacheStale()) return;
  await withLock("earthquake", 120, async () => {
    const data = await fetchEarthquakes();
    log.info({ events: data.length }, "Earthquake data updated");
  }).catch((err) => log.error({ err }, "Earthquake fetch failed"));
}

/**
 * Start the river level scraping scheduler and news feed fetcher.
 * Seeds gauge stations on first run, then scrapes every hour.
 * News feeds are fetched every 15 minutes.
 */
export async function startScheduler(): Promise<void> {
  log.info("Starting river level scheduler");

  // Initialize Redis for distributed locks
  try {
    lockRedis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    await lockRedis.connect();
    log.info("Scheduler Redis lock client connected");
  } catch {
    log.warn("Scheduler Redis unavailable — running single-instance mode");
    lockRedis = null;
  }

  // Ensure cleanup on process exit
  process.on("exit", stopScheduler);

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
    setTimeout(() => { runMlPredict(); }, 45_000),
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

  // Schedule ML predictions hourly (alongside scrape)
  setInterval(runMlPredict, SCRAPE_INTERVAL_MS);
  log.info({ intervalMs: SCRAPE_INTERVAL_MS }, "ML prediction scheduler started");

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
  if (lockRedis) {
    lockRedis.disconnect();
    lockRedis = null;
  }
  log.info("Schedulers stopped");
}
