# SPDX-License-Identifier: AGPL-3.0-only
"""
Prediction logic for Самур AI XGBoost models.
Loads trained models and performs inference using recent weather + water level data.
"""

import logging
import math
from datetime import date, datetime, timedelta
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
import xgboost as xgb

from .schemas import ForecastPoint

logger = logging.getLogger("samur-ai.predict")

HORIZONS = [1, 3, 7]

# Station metadata (mirrors gaugeStations.ts)
STATION_META = {
    "samur_usuhchaj": {"river": "Самур", "station": "Усухчай", "lat": 41.425, "lng": 47.925},
    "samur_ahty": {"river": "Самур", "station": "Ахты", "lat": 41.425, "lng": 47.825},
    "samur_luchek": {"river": "Самур", "station": "Лучек", "lat": 41.525, "lng": 48.175},
    "sulak_miatly": {"river": "Сулак", "station": "Миатлы", "lat": 42.925, "lng": 46.875},
    "sulak_yazykovka": {"river": "Сулак", "station": "Языковка", "lat": 43.375, "lng": 46.975},
    "sulak_sulak": {"river": "Сулак", "station": "Сулак", "lat": 43.525, "lng": 47.075},
}

WEATHER_API = "https://api.open-meteo.com/v1/forecast"
HISTORICAL_API = "https://archive-api.open-meteo.com/v1/archive"
DAILY_VARS = [
    "precipitation_sum", "temperature_2m_max", "temperature_2m_min",
    "snowfall_sum", "snow_depth_mean", "soil_moisture_0_to_7cm_mean",
    "et0_fao_evapotranspiration", "rain_sum",
]


class Predictor:
    def __init__(self, model_dir: Path, data_dir: Path):
        self.models: dict[str, dict[int, xgb.Booster]] = {}
        self.data_dir = data_dir
        self._load_models(model_dir)

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

    def loaded_stations(self) -> list[str]:
        return list(self.models.keys())

    def predict(self, station_id: str) -> list[ForecastPoint]:
        """Generate 7-day forecast for a station using XGBoost."""
        if station_id not in self.models:
            raise KeyError(f"No models loaded for station: {station_id}")

        meta = STATION_META[station_id]

        # Get recent data: try local CSV first, then fetch from APIs
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
        today = date.today()

        for h in HORIZONS:
            if h not in self.models[station_id]:
                continue

            model = self.models[station_id][h]
            X = latest[feature_cols].values
            dmat = xgb.DMatrix(X, feature_names=feature_cols)
            pred = float(model.predict(dmat)[0])

            forecast_date = today + timedelta(days=h)
            forecasts.append(ForecastPoint(
                date=forecast_date.isoformat(),
                level_cm=round(pred, 1),
                lower_90=round(pred * 0.85, 1),  # Simple 15% band for XGBoost
                upper_90=round(pred * 1.15, 1),
            ))

        # Interpolate between horizons for a smooth 7-day forecast
        if len(forecasts) >= 2:
            forecasts = self._interpolate_forecasts(forecasts, today)

        return forecasts

    def _get_recent_data(self, station_id: str, meta: dict) -> pd.DataFrame | None:
        """Get recent weather + water level data. Uses local CSV as primary source."""
        csv_path = self.data_dir / "time_series" / f"{station_id}.csv"
        if csv_path.exists():
            df = pd.read_csv(csv_path)
            df["date"] = pd.to_datetime(df["date"])
            # Use last 30 days of available data
            return df.tail(30).copy()

        # Fallback: fetch from Open-Meteo (weather only, no water level)
        logger.warning("No local CSV for %s, attempting API fetch", station_id)
        return self._fetch_recent_weather(meta)

    def _fetch_recent_weather(self, meta: dict) -> pd.DataFrame | None:
        """Fetch last 30 days of weather from Open-Meteo."""
        try:
            end = date.today() - timedelta(days=1)
            start = end - timedelta(days=30)
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
            # No water level available from API — fill with NaN
            df["water_level_cm"] = np.nan
            return df
        except Exception as e:
            logger.error("Failed to fetch weather: %s", e)
            return None

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
        """Interpolate between t+1, t+3, t+7 to get daily forecasts."""
        result = []
        # Build a map of known points
        known = {}
        for p in points:
            d = date.fromisoformat(p.date)
            days_ahead = (d - today).days
            known[days_ahead] = p

        for day in range(1, 8):
            if day in known:
                result.append(known[day])
            else:
                # Linear interpolation between nearest known points
                lower = max(k for k in known if k < day)
                upper = min(k for k in known if k > day)
                t = (day - lower) / (upper - lower)
                lp = known[lower]
                up = known[upper]
                level = lp.level_cm + t * (up.level_cm - lp.level_cm)
                lo90 = (lp.lower_90 or level) + t * ((up.lower_90 or level) - (lp.lower_90 or level))
                hi90 = (lp.upper_90 or level) + t * ((up.upper_90 or level) - (lp.upper_90 or level))
                result.append(ForecastPoint(
                    date=(today + timedelta(days=day)).isoformat(),
                    level_cm=round(level, 1),
                    lower_90=round(lo90, 1),
                    upper_90=round(hi90, 1),
                ))

        return result
