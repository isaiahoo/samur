# SPDX-License-Identifier: AGPL-3.0-only
"""
Prediction logic for Самур AI XGBoost models.
Loads trained models and performs inference using recent weather + water level data.
"""

import logging
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
import xgboost as xgb

from .schemas import ForecastPoint

logger = logging.getLogger("samur-ai.predict")

HORIZONS = [1, 3, 7]

# NSE thresholds used to gate user-facing forecasts. A horizon whose
# evaluation NSE falls below MIN_NSE_SERVING is dropped from responses
# entirely (worse than predicting the historical mean — actively
# misleading). skill_tier classifies the best *served* horizon for a
# station so the PWA can show an accuracy badge.
MIN_NSE_SERVING = 0.3

def _skill_tier(best_nse: float | None) -> str:
    if best_nse is None:
        return "none"
    if best_nse >= 0.75:
        return "high"
    if best_nse >= 0.5:
        return "medium"
    return "low"

# Station metadata (mirrors gaugeStations.ts)
STATION_META = {
    "samur_usuhchaj": {"river": "Самур", "station": "Усухчай", "lat": 41.425, "lng": 47.925},
    "samur_ahty": {"river": "Самур", "station": "Ахты", "lat": 41.425, "lng": 47.825},
    "samur_luchek": {"river": "Самур", "station": "Лучек", "lat": 41.525, "lng": 48.175},
    "sulak_miatly": {"river": "Сулак", "station": "Миатлы", "lat": 42.925, "lng": 46.875},
    "sulak_yazykovka": {"river": "Сулак", "station": "Языковка", "lat": 43.375, "lng": 46.975},
    "sulak_sulak": {"river": "Сулак", "station": "Сулак", "lat": 43.525, "lng": 47.075},
}

HISTORICAL_API = "https://archive-api.open-meteo.com/v1/archive"
# Express API base (inside Docker network)
EXPRESS_API = os.environ.get("API_BASE_URL", "http://api:3000")
DAILY_VARS = [
    "precipitation_sum", "temperature_2m_max", "temperature_2m_min",
    "snowfall_sum", "snow_depth_mean", "soil_moisture_0_to_7cm_mean",
    "et0_fao_evapotranspiration", "rain_sum",
]

# Shared timeout config for Express API calls (same Docker network = fast connect)
_EXPRESS_TIMEOUT = httpx.Timeout(10, connect=2)


class Predictor:
    def __init__(self, model_dir: Path, data_dir: Path):
        self.models: dict[str, dict[int, xgb.Booster]] = {}
        self.rmse: dict[str, dict[int, float]] = {}  # station → horizon → RMSE
        self.nse: dict[str, dict[int, float]] = {}   # station → horizon → NSE
        self.data_dir = data_dir
        self._express_reachable = True  # reset per predict cycle
        # inputs_source is set during _get_recent_data and read after the
        # prediction finishes. Keyed by station_id to survive the per-cycle
        # loop in /predict/all.
        self._last_inputs_source: dict[str, str] = {}
        self._load_models(model_dir)
        self._load_metrics(model_dir)

    def _load_models(self, model_dir: Path):
        """Load all XGBoost model files."""
        for station_id in STATION_META:
            station_models = {}
            for h in HORIZONS:
                path = model_dir / f"{station_id}_t{h}.json"
                if path.exists():
                    booster = xgb.Booster()
                    booster.load_model(str(path))
                    station_models[h] = booster
            if station_models:
                self.models[station_id] = station_models
                logger.info("Loaded %d horizon models for %s", len(station_models), station_id)

    def _load_metrics(self, model_dir: Path):
        """Load RMSE (for CI width) + NSE (for gating + skill tier)."""
        import json
        metrics_path = model_dir / "evaluation_results.json"
        if not metrics_path.exists():
            return
        with open(metrics_path) as f:
            data = json.load(f)
        for entry in data:
            sid = entry.get("basin_id", "")
            horizons = entry.get("horizons", {})
            station_rmse: dict[int, float] = {}
            station_nse: dict[int, float] = {}
            for h in HORIZONS:
                key = f"t{h}"
                if key in horizons:
                    if "rmse" in horizons[key]:
                        station_rmse[h] = horizons[key]["rmse"]
                    if "nse" in horizons[key]:
                        station_nse[h] = horizons[key]["nse"]
            if station_rmse:
                self.rmse[sid] = station_rmse
            if station_nse:
                self.nse[sid] = station_nse
        logger.info("Loaded metrics for %d stations", len(self.rmse))

    def loaded_stations(self) -> list[str]:
        return list(self.models.keys())

    def predict(self, station_id: str) -> list[ForecastPoint]:
        """Generate 7-day forecast for a station using XGBoost.

        Horizons whose evaluation NSE is below MIN_NSE_SERVING are silently
        dropped — those predictions are worse than the historical mean, and
        serving them to users as "AI" is actively misleading. If all horizons
        are gated, raises ValueError so the caller skips the station.
        """
        if station_id not in self.models:
            raise KeyError(f"No models loaded for station: {station_id}")

        meta = STATION_META[station_id]

        # Get recent data: live APIs first, CSV fallback
        recent = self._get_recent_data(station_id, meta)

        if recent is None or len(recent) < 15:
            raise ValueError(f"Insufficient recent data for {station_id} (need 15+ days)")

        # Build features from recent data
        features = self._build_features(recent)
        if features is None or len(features) == 0:
            raise ValueError(f"Could not build features for {station_id}")

        # Use the most recent complete row for prediction
        latest = features.iloc[-1:]
        feature_cols = self._feature_columns()

        forecasts = []
        today = datetime.now(timezone.utc).date()

        station_nse = self.nse.get(station_id, {})
        gated: list[int] = []

        for h in HORIZONS:
            if h not in self.models[station_id]:
                continue
            nse = station_nse.get(h)
            if nse is not None and nse < MIN_NSE_SERVING:
                gated.append(h)
                continue

            model = self.models[station_id][h]
            X = latest[feature_cols].values
            dmat = xgb.DMatrix(X, feature_names=feature_cols)
            pred = max(float(model.predict(dmat)[0]), 0.0)  # Clamp to non-negative

            forecast_date = today + timedelta(days=h)
            # 90% CI ≈ ±1.645 × RMSE (assumes roughly normal errors)
            rmse = self.rmse.get(station_id, {}).get(h, pred * 0.15)
            band = max(1.645 * rmse, 5.0)
            forecasts.append(ForecastPoint(
                date=forecast_date.isoformat(),
                level_cm=round(pred, 1),
                lower_90=round(max(pred - band, 0.0), 1),
                upper_90=round(pred + band, 1),
            ))

        if gated:
            logger.info("Gated %d horizons for %s (NSE < %.2f): %s",
                        len(gated), station_id, MIN_NSE_SERVING, gated)

        if not forecasts:
            raise ValueError(f"All horizons gated for {station_id} (low NSE)")

        # Interpolate between horizons within the served span only — do not
        # extrapolate beyond the furthest reliable horizon.
        if len(forecasts) >= 2:
            forecasts = self._interpolate_forecasts(forecasts, today)

        return forecasts

    def best_nse(self, station_id: str) -> float | None:
        """Return the highest NSE across horizons that would be served
        (i.e. above MIN_NSE_SERVING). None if the station has no metrics."""
        horizons = self.nse.get(station_id, {})
        served = [v for v in horizons.values() if v >= MIN_NSE_SERVING]
        return max(served) if served else None

    def skill_tier(self, station_id: str) -> str:
        return _skill_tier(self.best_nse(station_id))

    def last_inputs_source(self, station_id: str) -> str:
        return self._last_inputs_source.get(station_id, "unknown")

    def _get_recent_data(self, station_id: str, meta: dict) -> pd.DataFrame | None:
        """Get recent weather + water level data.

        Primary path: fetch live weather from Open-Meteo + water levels from Express API.
        Fallback: use local CSV (training data) when water levels can't be fetched.

        Records the actual inputs source in self._last_inputs_source[station_id]
        so the API response can warn users when predictions are running on
        climatology fallback rather than live observations.
        """
        self._last_inputs_source[station_id] = "unknown"
        # Always try live data first — CSVs contain old training data
        live = self._fetch_recent_weather(station_id, meta)
        if live is not None and len(live) >= 15:
            wl_count = live["water_level_cm"].notna().sum()
            # last_source is set inside _fill_water_levels; capture here
            source = self._last_inputs_source.get(station_id, "unknown")
            logger.info("Live data for %s: %d days, %d with water levels (source=%s)",
                        station_id, len(live), wl_count, source)
            if wl_count >= 15:
                return live

        # Fallback: local CSV (stale training data — water level lags from historical period)
        csv_path = self.data_dir / "time_series" / f"{station_id}.csv"
        if csv_path.exists():
            logger.warning("Using CSV fallback for %s (insufficient live water levels)", station_id)
            self._last_inputs_source[station_id] = "training-csv"
            df = pd.read_csv(csv_path)
            df["date"] = pd.to_datetime(df["date"])
            return df.tail(45).copy()

        return None

    def _fetch_recent_weather(self, station_id: str, meta: dict) -> pd.DataFrame | None:
        """Fetch recent weather from Open-Meteo + water levels from Express API.

        Water level strategy (in priority order):
        1. Live scraped data from river_levels (last 30 days)
        2. Imported historical data from historical_river_levels (2001-2020+)
        3. Day-of-year averages from historical_river_stats
        """
        try:
            end = datetime.now(timezone.utc).date() - timedelta(days=1)
            start = end - timedelta(days=45)
            params = [
                ("latitude", str(meta["lat"])),
                ("longitude", str(meta["lng"])),
                ("start_date", start.isoformat()),
                ("end_date", end.isoformat()),
                ("timezone", "auto"),
            ] + [("daily", v) for v in DAILY_VARS]

            with httpx.Client(timeout=30) as client:
                resp = client.get(HISTORICAL_API, params=params)
                resp.raise_for_status()
                data = resp.json()

            daily = data.get("daily", {})
            if not daily or "time" not in daily:
                return None

            df = pd.DataFrame({"date": pd.to_datetime(daily["time"])})
            for var in DAILY_VARS:
                df[var] = daily.get(var, [None] * len(daily["time"]))

            df["water_level_cm"] = np.nan
            river = meta["river"]
            station = meta["station"]

            # Skip Express API if previously marked unreachable (reset per predict cycle)
            if self._express_reachable:
                self._fill_water_levels(station_id, df, river, station, start, end)

            return df
        except Exception as e:
            logger.error("Failed to fetch weather: %s", e)
            return None

    def _fill_water_levels(self, station_id: str, df: pd.DataFrame, river: str, station: str,
                           start: date, end: date) -> None:
        """Try all water level strategies using a single HTTP client.

        Records the source of the majority of filled rows on
        self._last_inputs_source[station_id] so the API can warn users
        when predictions are being built on climatology rather than live
        observations.
        """
        try:
            with httpx.Client(timeout=_EXPRESS_TIMEOUT) as client:
                before = int(df["water_level_cm"].notna().sum())

                # Strategy 1: live scraped water levels (most recent, from hourly scraper)
                self._fetch_live_levels(df, river, station, client)
                after_live = int(df["water_level_cm"].notna().sum())

                # Strategy 2: imported historical data (covers 2001-2020+)
                if after_live < 15:
                    self._fetch_historical_levels(df, river, station, start, end, client)
                after_hist = int(df["water_level_cm"].notna().sum())

                # Strategy 3: day-of-year averages (always available, lowest quality)
                if after_hist < 15:
                    self._fetch_stats_levels(df, river, station, client)
                after_stats = int(df["water_level_cm"].notna().sum())

                fills = {
                    "live-observations": after_live - before,
                    "historical-imports": after_hist - after_live,
                    "climatology": after_stats - after_hist,
                }
                source = max(fills, key=lambda k: fills[k])
                self._last_inputs_source[station_id] = source if fills[source] > 0 else "unknown"
        except (httpx.ConnectError, httpx.ConnectTimeout):
            # Express API is unreachable — skip it for all remaining stations
            logger.warning("Express API unreachable, skipping water level fetch for remaining stations")
            self._express_reachable = False

    def _fetch_live_levels(self, df: pd.DataFrame, river: str, station: str,
                           client: httpx.Client) -> None:
        """Fill water_level_cm from live scraped data (river_levels table)."""
        try:
            url = f"{EXPRESS_API}/api/v1/river-levels/history/{river}/{station}"
            resp = client.get(url, params={"days": "30", "includeForecast": "false"})
            resp.raise_for_status()
            levels_data = resp.json().get("data", [])

            if not levels_data:
                return

            level_by_date: dict[str, float] = {}
            for rec in levels_data:
                level = rec.get("levelCm")
                if level is not None:
                    d = rec["measuredAt"][:10]
                    level_by_date[d] = level
            if level_by_date:
                df["water_level_cm"] = df["date"].dt.strftime("%Y-%m-%d").map(level_by_date)
                matched = df["water_level_cm"].notna().sum()
                logger.info("Live water levels: %d/%d days matched for %s/%s",
                            matched, len(df), river, station)
        except (httpx.ConnectError, httpx.ConnectTimeout):
            raise  # Propagate to _fill_water_levels for circuit-breaker
        except Exception as e:
            logger.warning("Could not fetch live water levels for %s/%s: %s", river, station, e)

    def _fetch_historical_levels(self, df: pd.DataFrame, river: str, station: str,
                                  start: date, end: date, client: httpx.Client) -> None:
        """Fill water_level_cm from imported historical data (historical_river_levels table)."""
        try:
            url = f"{EXPRESS_API}/api/v1/river-levels/historical/{river}/{station}"
            resp = client.get(url, params={
                "from": start.isoformat(),
                "to": end.isoformat(),
                "limit": "100",
            })
            resp.raise_for_status()
            hist_data = resp.json().get("data", [])

            if not hist_data:
                return

            level_by_date: dict[str, float] = {}
            for rec in hist_data:
                d = rec["date"][:10]
                level_by_date[d] = rec["valueCm"]
            if level_by_date:
                # Only fill NaN slots (don't overwrite live data)
                mapped = df["date"].dt.strftime("%Y-%m-%d").map(level_by_date)
                df["water_level_cm"] = df["water_level_cm"].fillna(mapped)
                matched = df["water_level_cm"].notna().sum()
                logger.info("Historical levels: %d/%d days after merge for %s/%s",
                            matched, len(df), river, station)
        except (httpx.ConnectError, httpx.ConnectTimeout):
            raise  # Propagate to _fill_water_levels for circuit-breaker
        except Exception as e:
            logger.warning("Could not fetch historical levels for %s/%s: %s", river, station, e)

    def _fetch_stats_levels(self, df: pd.DataFrame, river: str, station: str,
                            client: httpx.Client) -> None:
        """Fill water_level_cm from day-of-year averages (historical_river_stats table)."""
        try:
            url = f"{EXPRESS_API}/api/v1/river-levels/historical/{river}/{station}/stats"
            resp = client.get(url)
            resp.raise_for_status()
            stats = resp.json().get("data", [])

            if not stats:
                return

            avg_by_doy: dict[int, float] = {}
            for s in stats:
                doy = s.get("dayOfYear")
                avg = s.get("avgCm")
                if doy is not None and avg is not None:
                    avg_by_doy[doy] = avg

            # Only fill remaining NaN slots
            mapped = df["date"].dt.dayofyear.map(avg_by_doy)
            df["water_level_cm"] = df["water_level_cm"].fillna(mapped)
            matched = df["water_level_cm"].notna().sum()
            logger.info("Stats-based levels: %d/%d days after merge for %s/%s",
                        matched, len(df), river, station)
            # Forward-fill small gaps
            if matched > 0:
                df["water_level_cm"] = df["water_level_cm"].ffill().bfill()
        except (httpx.ConnectError, httpx.ConnectTimeout):
            raise  # Propagate to _fill_water_levels for circuit-breaker
        except Exception as e:
            logger.warning("Could not fetch historical stats for %s/%s: %s", river, station, e)

    def _build_features(self, df: pd.DataFrame) -> pd.DataFrame | None:
        """Build ML features from recent data (same as training)."""
        feat = df.copy()

        # Lagged water levels
        for lag in [1, 2, 3, 7, 14]:
            feat[f"level_lag_{lag}"] = feat["water_level_cm"].shift(lag)

        # Rolling precipitation
        for window in [3, 7, 14]:
            feat[f"precip_{window}d"] = feat["precipitation_sum"].rolling(window).sum()

        # Rolling temperature
        feat["tmax_3d"] = feat["temperature_2m_max"].rolling(3).mean()
        feat["tmin_3d"] = feat["temperature_2m_min"].rolling(3).mean()
        feat["tmax_7d"] = feat["temperature_2m_max"].rolling(7).mean()

        # Snowmelt
        feat["snow_melt_3d"] = -feat["snow_depth_mean"].diff(3)
        feat["snow_melt_7d"] = -feat["snow_depth_mean"].diff(7)

        # Soil moisture change
        feat["soil_moisture_change_7d"] = feat["soil_moisture_0_to_7cm_mean"].diff(7)

        # Water level trends
        feat["level_change_1d"] = feat["water_level_cm"].diff(1)
        feat["level_change_3d"] = feat["water_level_cm"].diff(3)
        feat["level_change_7d"] = feat["water_level_cm"].diff(7)

        # Seasonality
        doy = feat["date"].dt.dayofyear
        feat["sin_doy"] = np.sin(2 * np.pi * doy / 365.25)
        feat["cos_doy"] = np.cos(2 * np.pi * doy / 365.25)
        feat["month"] = feat["date"].dt.month

        return feat.dropna(subset=self._feature_columns())

    def _feature_columns(self) -> list[str]:
        """Feature column names (must match training order)."""
        return (
            DAILY_VARS
            + [f"level_lag_{l}" for l in [1, 2, 3, 7, 14]]
            + [f"precip_{w}d" for w in [3, 7, 14]]
            + ["tmax_3d", "tmin_3d", "tmax_7d"]
            + ["snow_melt_3d", "snow_melt_7d"]
            + ["soil_moisture_change_7d"]
            + ["level_change_1d", "level_change_3d", "level_change_7d"]
            + ["sin_doy", "cos_doy", "month"]
        )

    def _interpolate_forecasts(self, points: list[ForecastPoint], today: date) -> list[ForecastPoint]:
        """Linearly interpolate between served horizons to get daily forecasts.

        Only fills days *within* the served horizon span — we never extrapolate
        past the last reliable horizon, because copying the nearest point
        silently turns gated-out days into confident-looking predictions.
        """
        result = []
        known: dict[int, ForecastPoint] = {}
        for p in points:
            d = date.fromisoformat(p.date)
            days_ahead = (d - today).days
            known[days_ahead] = p

        if not known:
            return result

        min_day = min(known.keys())
        max_day = max(known.keys())

        for day in range(min_day, max_day + 1):
            if day in known:
                result.append(known[day])
                continue
            # day is strictly between min_day and max_day, so interpolation is safe
            below = max(k for k in known if k < day)
            above = min(k for k in known if k > day)
            t = (day - below) / (above - below)
            lp = known[below]
            up = known[above]
            level = max(lp.level_cm + t * (up.level_cm - lp.level_cm), 0.0)
            lo90 = max((lp.lower_90 or level) + t * ((up.lower_90 or level) - (lp.lower_90 or level)), 0.0)
            hi90 = max((lp.upper_90 or level) + t * ((up.upper_90 or level) - (lp.upper_90 or level)), 0.0)
            result.append(ForecastPoint(
                date=(today + timedelta(days=day)).isoformat(),
                level_cm=round(level, 1),
                lower_90=round(lo90, 1),
                upper_90=round(hi90, 1),
            ))

        return result
