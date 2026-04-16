#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""
Build per-station rating curves: water_level_cm = a · discharge^b

For each ML station:
  1. Load the training CSV (paired date → water_level_cm).
  2. Fetch Open-Meteo GloFAS historical discharge for the same date span.
  3. Pair by date, fit power law in log-log space (robust to outliers).
  4. Output coefficients + diagnostics to apps/ml/models/rating_curves.json.

The Express scraper reads this JSON and, when HTML scraping fails (it does,
both allrivers.info and urovenvody.ru parsers are broken), derives level_cm
from Open-Meteo's discharge using the curve. Without this step, level_cm
stays NULL in every scraped row and the AI service falls back to
day-of-year climatology for every prediction.

R² on the held-out-year split is the headline number. R² < 0.6 → the curve
will not be applied for that station and the scraper keeps level_cm NULL
(status-quo fallback preserved).
"""

import argparse
import json
import logging
from datetime import date, datetime, timedelta
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("build-rating-curves")

SCRIPT_DIR = Path(__file__).resolve().parent
ML_DIR = SCRIPT_DIR.parent
DATA_DIR = ML_DIR / "data" / "time_series"
OUT_PATH = ML_DIR / "models" / "rating_curves.json"

# Station coordinates mirror STATION_META in apps/ml/app/predict.py
STATIONS = {
    "samur_usuhchaj": {"river": "Самур", "station": "Усухчай", "lat": 41.425, "lng": 47.925},
    "samur_ahty":     {"river": "Самур", "station": "Ахты",    "lat": 41.425, "lng": 47.825},
    "samur_luchek":   {"river": "Самур", "station": "Лучек",   "lat": 41.525, "lng": 48.175},
    "sulak_miatly":   {"river": "Сулак", "station": "Миатлы",  "lat": 42.925, "lng": 46.875},
    "sulak_yazykovka":{"river": "Сулак", "station": "Языковка","lat": 43.375, "lng": 46.975},
    "sulak_sulak":    {"river": "Сулак", "station": "Сулак",   "lat": 43.525, "lng": 47.075},
}

ARCHIVE_API = "https://archive-api.open-meteo.com/v1/archive"
FLOOD_ARCHIVE_API = "https://flood-api.open-meteo.com/v1/flood"

# Minimum R² on hold-out year for the curve to be accepted. Stations below
# this bar are omitted from the output — scraper keeps level_cm NULL for
# them and the ML service falls back to climatology as today. Sulak-basin
# stations fail this bar because they're downstream of regulated dams
# (Chirkey/Irganai) where gauge level reflects operator decisions, not
# weather-driven streamflow. Nothing in a GloFAS grid-cell can recover
# those dynamics.
MIN_R2 = 0.4


def fetch_discharge(lat: float, lng: float, start: date, end: date) -> pd.DataFrame:
    """Fetch daily GloFAS discharge for [start, end] in yearly chunks to
    respect Open-Meteo's per-request limits. Returns date → discharge frame."""
    chunks: list[pd.DataFrame] = []
    with httpx.Client(timeout=60) as client:
        cur = start
        while cur <= end:
            chunk_end = min(cur.replace(year=cur.year + 1) - timedelta(days=1), end)
            params = {
                "latitude": str(lat),
                "longitude": str(lng),
                "start_date": cur.isoformat(),
                "end_date": chunk_end.isoformat(),
                "daily": "river_discharge",
                "timezone": "auto",
            }
            log.debug("GloFAS %s..%s", cur, chunk_end)
            resp = client.get(FLOOD_ARCHIVE_API, params=params)
            resp.raise_for_status()
            data = resp.json()
            daily = data.get("daily") or {}
            if "time" in daily and "river_discharge" in daily:
                chunks.append(pd.DataFrame({
                    "date": pd.to_datetime(daily["time"]),
                    "discharge": daily["river_discharge"],
                }))
            cur = chunk_end + timedelta(days=1)
    if not chunks:
        return pd.DataFrame(columns=["date", "discharge"])
    return pd.concat(chunks, ignore_index=True)


def _seasonal_features(df: pd.DataFrame) -> np.ndarray:
    """Feature matrix built from the paired dataframe (sorted by date):

    [1, Q, log(Q), Q_3d, Q_7d, log(Q_3d), sin(doy), cos(doy),
     Q·sin(doy), Q·cos(doy), sin(2·doy), cos(2·doy)]

    Captures: baseline, instantaneous + multi-day-rolling discharge,
    annual + semi-annual seasonality, and seasonally-modulated Q
    sensitivity. The rolling features model the fact that water level
    at a gauge lags cumulative upstream flow.
    """
    df = df.sort_values("date").reset_index(drop=True)
    Q = df["discharge"].values
    # Rolling means — ffill/bfill first 6 days from current Q
    Q_3d = df["discharge"].rolling(3, min_periods=1).mean().values
    Q_7d = df["discharge"].rolling(7, min_periods=1).mean().values
    doy = df["date"].dt.dayofyear.values.astype(float)
    theta = 2.0 * np.pi * doy / 365.25
    s, c = np.sin(theta), np.cos(theta)
    s2, c2 = np.sin(2 * theta), np.cos(2 * theta)
    logQ = np.log(Q)
    logQ3 = np.log(Q_3d)
    return np.column_stack([
        np.ones_like(Q),
        Q, logQ, Q_3d, Q_7d, logQ3,
        s, c, Q * s, Q * c,
        s2, c2,
    ])


def evaluate_split(df: pd.DataFrame, split_year: int) -> dict:
    """Fit a seasonally-adjusted discharge→level model on data before
    split_year; evaluate on split_year+.

    Model: level = β₀ + β₁·Q + β₂·log(Q) + β₃·sin(doy) + β₄·cos(doy)
                 + β₅·Q·sin(doy) + β₆·Q·cos(doy)

    We also fit a pure power-law as a baseline — if it beats the
    seasonal model on the held-out year we fall back to it.
    """
    train = df[df["date"].dt.year < split_year]
    test = df[df["date"].dt.year >= split_year]

    train_mask = (train["discharge"] > 0) & (train["water_level_cm"] > 0)
    test_mask = (test["discharge"] > 0) & (test["water_level_cm"] > 0)
    train = train[train_mask]
    test = test[test_mask]

    if len(train) < 60 or len(test) < 60:
        return {"ok": False, "reason": f"insufficient paired data (train={len(train)}, test={len(test)})"}

    # Seasonal + rolling-discharge model via least squares
    X_train = _seasonal_features(train)
    y_train = train.sort_values("date")["water_level_cm"].values
    beta, *_ = np.linalg.lstsq(X_train, y_train, rcond=None)

    X_test = _seasonal_features(test)
    y_true = test.sort_values("date")["water_level_cm"].values
    y_pred = X_test @ beta

    ss_res = float(np.sum((y_true - y_pred) ** 2))
    ss_tot = float(np.sum((y_true - y_true.mean()) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else float("nan")
    rmse = float(np.sqrt(np.mean((y_true - y_pred) ** 2)))

    return {
        "ok": True,
        "model": "seasonal-rolling-v1",
        "coefs": [round(float(x), 6) for x in beta],
        "feature_names": [
            "intercept", "Q", "logQ", "Q_3d", "Q_7d", "logQ_3d",
            "sin_doy", "cos_doy", "Q_sin_doy", "Q_cos_doy",
            "sin_2doy", "cos_2doy",
        ],
        "n_train": int(len(train)),
        "n_test": int(len(test)),
        "r2": round(r2, 4),
        "rmse_cm": round(rmse, 2),
        "mean_level_cm": round(float(y_true.mean()), 1),
        "discharge_min": round(float(train["discharge"].min()), 3),
        "discharge_max": round(float(train["discharge"].max()), 3),
    }


def build_curve(station_id: str, meta: dict) -> dict:
    csv_path = DATA_DIR / f"{station_id}.csv"
    if not csv_path.exists():
        return {"station_id": station_id, "ok": False, "reason": f"no CSV at {csv_path}"}

    levels = pd.read_csv(csv_path, usecols=["date", "water_level_cm"])
    levels["date"] = pd.to_datetime(levels["date"])
    levels = levels.dropna(subset=["water_level_cm"])
    if levels.empty:
        return {"station_id": station_id, "ok": False, "reason": "empty level CSV"}

    start = levels["date"].min().date()
    end = levels["date"].max().date()
    log.info("[%s] %d level rows from %s to %s", station_id, len(levels), start, end)

    discharge = fetch_discharge(meta["lat"], meta["lng"], start, end)
    if discharge.empty:
        return {"station_id": station_id, "ok": False, "reason": "GloFAS returned no discharge"}

    merged = levels.merge(discharge, on="date", how="inner")
    merged = merged.dropna(subset=["discharge", "water_level_cm"])
    log.info("[%s] %d paired level+discharge samples", station_id, len(merged))

    # Hold out the last full year for evaluation
    split_year = int(merged["date"].dt.year.max())
    if split_year <= int(merged["date"].dt.year.min()):
        return {"station_id": station_id, "ok": False, "reason": "only one year of data, cannot split"}

    result = evaluate_split(merged, split_year)
    result["station_id"] = station_id
    result["river"] = meta["river"]
    result["station"] = meta["station"]
    result["split_year"] = split_year
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--station", help="Only fit the given station id")
    parser.add_argument("--min-r2", type=float, default=MIN_R2,
                       help="Minimum held-out R² to accept a curve")
    parser.add_argument("--out", default=str(OUT_PATH), help="Output JSON path")
    args = parser.parse_args()

    stations = {args.station: STATIONS[args.station]} if args.station else STATIONS

    curves: dict[str, dict] = {}
    diagnostics: list[dict] = []

    for sid, meta in stations.items():
        try:
            r = build_curve(sid, meta)
        except httpx.HTTPError as e:
            log.error("[%s] GloFAS HTTP error: %s", sid, e)
            r = {"station_id": sid, "ok": False, "reason": f"HTTP error: {e}"}
        except Exception as e:
            log.exception("[%s] unexpected error", sid)
            r = {"station_id": sid, "ok": False, "reason": f"error: {e}"}

        diagnostics.append(r)

        if not r.get("ok"):
            log.warning("[%s] SKIP — %s", sid, r.get("reason"))
            continue

        if r["r2"] < args.min_r2:
            log.warning("[%s] REJECT — R² %.3f below threshold %.2f", sid, r["r2"], args.min_r2)
            continue

        curves[sid] = {
            "model": r["model"],
            "coefs": r["coefs"],
            "feature_names": r["feature_names"],
            "r2": r["r2"],
            "n_pairs": r["n_train"] + r["n_test"],
            "rmse_cm": r["rmse_cm"],
            "discharge_range": [r["discharge_min"], r["discharge_max"]],
        }
        log.info("[%s] ACCEPT — seasonal model (R²=%.3f, RMSE=%.1fcm, n=%d)",
                 sid, r["r2"], r["rmse_cm"], curves[sid]["n_pairs"])

    payload = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "min_r2": args.min_r2,
        "curves": curves,
        "diagnostics": diagnostics,
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    log.info("Wrote %d curves to %s", len(curves), out_path)

    # Compact table for the terminal
    print("\n=== Summary ===")
    print(f"{'station':22s} {'status':8s} {'R²':>6s} {'RMSE':>7s} {'n':>6s}  formula")
    for d in diagnostics:
        sid = d["station_id"]
        accepted = sid in curves
        status = "accept" if accepted else ("reject" if d.get("ok") else "fail")
        r2 = f"{d['r2']:.3f}" if d.get("ok") else "  —"
        rmse = f"{d['rmse_cm']:.1f}cm" if d.get("ok") else "   —"
        n = f"{(d['n_train'] + d['n_test'])}" if d.get("ok") else "—"
        if accepted:
            formula = f"seasonal[{','.join(f'{c:+.2f}' for c in d['coefs'])}]"
        elif d.get("ok"):
            formula = f"R²={d['r2']:.3f} below threshold"
        else:
            formula = d.get("reason", "?")
        print(f"{sid:22s} {status:8s} {r2:>6s} {rmse:>7s} {n:>6s}  {formula}")


if __name__ == "__main__":
    main()
