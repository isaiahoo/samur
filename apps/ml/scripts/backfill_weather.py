#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""
Backfill ERA5 reanalysis weather data for all 6 gauge stations.
Fetches from Open-Meteo Historical Weather API (free, no key needed).
Joins with water level data from the historical_river_levels table.
Outputs per-station CSVs ready for ML training.
"""

import os
import sys
import time
import json
from datetime import date, timedelta
from pathlib import Path

import httpx
import pandas as pd
import psycopg2

# ── Station registry (mirrors gaugeStations.ts for the 6 historical stations) ──

STATIONS = [
    {
        "basin_id": "samur_usuhchaj",
        "river_name": "Самур",
        "station_name": "Усухчай",
        "open_meteo_lat": 41.425,
        "open_meteo_lng": 47.925,
        "date_start": "2001-01-01",
        "date_end": "2024-12-31",
    },
    {
        "basin_id": "samur_ahty",
        "river_name": "Самур",
        "station_name": "Ахты",
        "open_meteo_lat": 41.425,
        "open_meteo_lng": 47.825,
        "date_start": "2008-01-01",
        "date_end": "2024-12-31",
    },
    {
        "basin_id": "samur_luchek",
        "river_name": "Самур",
        "station_name": "Лучек",
        "open_meteo_lat": 41.525,
        "open_meteo_lng": 48.175,
        "date_start": "2008-01-01",
        "date_end": "2024-12-31",
    },
    {
        "basin_id": "sulak_miatly",
        "river_name": "Сулак",
        "station_name": "Миатлы",
        "open_meteo_lat": 42.925,
        "open_meteo_lng": 46.875,
        "date_start": "2008-01-01",
        "date_end": "2024-12-31",
    },
    {
        "basin_id": "sulak_yazykovka",
        "river_name": "Сулак",
        "station_name": "Языковка",
        "open_meteo_lat": 43.375,
        "open_meteo_lng": 46.975,
        "date_start": "2008-01-01",
        "date_end": "2024-12-31",
    },
    {
        "basin_id": "sulak_sulak",
        "river_name": "Сулак",
        "station_name": "Сулак",
        "open_meteo_lat": 43.525,
        "open_meteo_lng": 47.075,
        "date_start": "2008-01-01",
        "date_end": "2024-12-31",
    },
]

HISTORICAL_API = "https://archive-api.open-meteo.com/v1/archive"
DAILY_VARS = [
    "precipitation_sum",
    "temperature_2m_max",
    "temperature_2m_min",
    "snowfall_sum",
    "snow_depth_mean",
    "soil_moisture_0_to_7cm_mean",
    "et0_fao_evapotranspiration",
    "rain_sum",
]

OUTPUT_DIR = Path(__file__).parent.parent / "data" / "time_series"


def get_db_url() -> str:
    """Get DATABASE_URL from environment or .env file."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        # Try reading from project root .env
        env_path = Path(__file__).parent.parent.parent.parent / ".env"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("DATABASE_URL="):
                    url = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    if not url:
        raise RuntimeError("DATABASE_URL not set. Export it or create .env at project root.")
    # Strip Prisma-specific query params (e.g., ?schema=public)
    if "?" in url:
        url = url.split("?")[0]
    return url


def fetch_water_levels(conn, river_name: str, station_name: str) -> pd.DataFrame:
    """Fetch historical water levels from the database."""
    query = """
        SELECT date, value_cm
        FROM historical_river_levels
        WHERE river_name = %s AND station_name = %s
          AND value_cm > -100 AND value_cm < 2000
        ORDER BY date ASC
    """
    with conn.cursor() as cur:
        cur.execute(query, (river_name, station_name))
        rows = cur.fetchall()
    if not rows:
        return pd.DataFrame(columns=["date", "water_level_cm"])
    df = pd.DataFrame(rows, columns=["date", "water_level_cm"])
    df["date"] = pd.to_datetime(df["date"]).dt.date
    return df


def fetch_weather_year(lat: float, lng: float, year: int, client: httpx.Client) -> dict:
    """Fetch one year of ERA5 daily weather data from Open-Meteo with retry on 429."""
    start = f"{year}-01-01"
    end = f"{year}-12-31"
    params = [
        ("latitude", str(lat)),
        ("longitude", str(lng)),
        ("start_date", start),
        ("end_date", end),
        ("timezone", "auto"),
    ] + [("daily", v) for v in DAILY_VARS]

    max_retries = 5
    for attempt in range(max_retries):
        resp = client.get(HISTORICAL_API, params=params, timeout=60)
        if resp.status_code == 429:
            wait = min(30 * (2 ** attempt), 120)  # 30s, 60s, 120s, 120s, 120s
            print(f"RATE LIMITED, waiting {wait}s...", end=" ", flush=True)
            time.sleep(wait)
            continue
        resp.raise_for_status()
        return resp.json()
    raise httpx.HTTPStatusError(f"Rate limited after {max_retries} retries", request=resp.request, response=resp)


def fetch_all_weather(station: dict, client: httpx.Client) -> pd.DataFrame:
    """Fetch all years of weather data for a station."""
    start_year = int(station["date_start"][:4])
    # ERA5 data availability lags ~5 days; cap at last full year
    end_year = min(int(station["date_end"][:4]), date.today().year - 1)

    all_frames = []
    for year in range(start_year, end_year + 1):
        print(f"    Fetching weather {year}...", end=" ", flush=True)
        try:
            data = fetch_weather_year(
                station["open_meteo_lat"], station["open_meteo_lng"], year, client
            )
            daily = data.get("daily", {})
            if not daily or "time" not in daily:
                print("EMPTY")
                continue

            df_year = pd.DataFrame({"date": daily["time"]})
            for var in DAILY_VARS:
                # API may return slightly different key names
                col = daily.get(var, [None] * len(daily["time"]))
                df_year[var] = col
            all_frames.append(df_year)
            print(f"OK ({len(df_year)} days)")
        except httpx.HTTPStatusError as e:
            print(f"HTTP {e.response.status_code}")
        except Exception as e:
            print(f"ERROR: {e}")

        # Rate limiting: be polite to the free API (10k req/day, ~600/min)
        time.sleep(1.5)

    if not all_frames:
        return pd.DataFrame()

    weather = pd.concat(all_frames, ignore_index=True)
    weather["date"] = pd.to_datetime(weather["date"]).dt.date
    weather = weather.sort_values("date").drop_duplicates(subset=["date"])
    return weather


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    db_url = get_db_url()
    print(f"Connecting to database...")
    conn = psycopg2.connect(db_url)

    client = httpx.Client(
        headers={"User-Agent": "SamurAI/1.0 (flood-prediction research)"},
        follow_redirects=True,
    )

    summary = []

    for station in STATIONS:
        basin_id = station["basin_id"]
        print(f"\n{'='*60}")
        print(f"Station: {station['river_name']} / {station['station_name']} ({basin_id})")
        print(f"{'='*60}")

        # Skip if output CSV already exists and has enough data
        out_path = OUTPUT_DIR / f"{basin_id}.csv"
        if out_path.exists():
            existing = pd.read_csv(out_path)
            wl_expected = {"samur_usuhchaj": 7000, "samur_ahty": 3500, "samur_luchek": 4000,
                           "sulak_miatly": 4000, "sulak_yazykovka": 4000, "sulak_sulak": 4000}
            if len(existing) >= wl_expected.get(basin_id, 3000):
                print(f"  SKIP — already have {len(existing)} rows in {out_path.name}")
                summary.append({"station": basin_id, "weather_days": len(existing),
                                "joined_days": len(existing),
                                "date_range": f"{existing['date'].min()} → {existing['date'].max()}"})
                continue

        # 1. Fetch water levels from DB
        print("  Fetching water levels from DB...")
        wl = fetch_water_levels(conn, station["river_name"], station["station_name"])
        print(f"  Water levels: {len(wl)} readings")
        if wl.empty:
            print("  SKIP — no water level data")
            summary.append({"station": basin_id, "weather_days": 0, "joined_days": 0})
            continue

        # 2. Fetch weather data from Open-Meteo
        print("  Fetching weather data from Open-Meteo...")
        weather = fetch_all_weather(station, client)
        print(f"  Weather: {len(weather)} days")
        if weather.empty:
            print("  SKIP — no weather data")
            summary.append({"station": basin_id, "weather_days": 0, "joined_days": 0})
            continue

        # 3. Inner join on date
        merged = pd.merge(weather, wl, on="date", how="inner")
        merged = merged.sort_values("date")
        print(f"  Joined: {len(merged)} days (weather + water level)")

        # 4. Fill NaN weather values with interpolation (small gaps are OK)
        for col in DAILY_VARS:
            if col in merged.columns:
                merged[col] = merged[col].interpolate(method="linear", limit=3)

        # 5. Save CSV
        out_path = OUTPUT_DIR / f"{basin_id}.csv"
        merged.to_csv(out_path, index=False)
        print(f"  Saved: {out_path}")

        summary.append({
            "station": basin_id,
            "weather_days": len(weather),
            "joined_days": len(merged),
            "date_range": f"{merged['date'].min()} → {merged['date'].max()}",
        })

    conn.close()
    client.close()

    # Print summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    for s in summary:
        print(f"  {s['station']}: {s.get('joined_days', 0)} training days"
              + (f" ({s.get('date_range', 'N/A')})" if s.get('date_range') else ""))
    print(f"\nTotal training rows: {sum(s.get('joined_days', 0) for s in summary)}")


if __name__ == "__main__":
    main()
