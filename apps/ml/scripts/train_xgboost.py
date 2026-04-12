#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""
Train XGBoost baseline models for flood prediction.
Per-station models predicting water_level_cm at t+1, t+3, t+7.

Features:
- Lagged water levels (t-1, t-2, t-3, t-7, t-14)
- Rolling precipitation sums (3d, 7d, 14d)
- Rolling temperature stats
- Snowmelt proxy (snow depth decrease)
- Soil moisture + 7d change
- Seasonality (sin/cos day-of-year)

Evaluation: NSE, KGE, RMSE, peak detection
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_squared_error

DATA_DIR = Path(__file__).parent.parent / "data" / "time_series"
MODEL_DIR = Path(__file__).parent.parent / "models"
ATTRS_PATH = Path(__file__).parent.parent / "data" / "attributes.csv"

HORIZONS = [1, 3, 7]  # predict t+1, t+3, t+7
WEATHER_COLS = [
    "precipitation_sum", "temperature_2m_max", "temperature_2m_min",
    "snowfall_sum", "snow_depth_mean", "soil_moisture_0_to_7cm_mean",
    "et0_fao_evapotranspiration", "rain_sum",
]


def compute_nse(obs: np.ndarray, sim: np.ndarray) -> float:
    """Nash-Sutcliffe Efficiency. 1.0 = perfect, <0 = worse than mean."""
    mean_obs = np.mean(obs)
    ss_res = np.sum((obs - sim) ** 2)
    ss_tot = np.sum((obs - mean_obs) ** 2)
    if ss_tot == 0:
        return 0.0
    return 1.0 - ss_res / ss_tot


def compute_kge(obs: np.ndarray, sim: np.ndarray) -> float:
    """Kling-Gupta Efficiency. Decomposes into correlation, bias, variability."""
    r = np.corrcoef(obs, sim)[0, 1] if len(obs) > 1 else 0.0
    alpha = np.std(sim) / np.std(obs) if np.std(obs) > 0 else 0.0
    beta = np.mean(sim) / np.mean(obs) if np.mean(obs) > 0 else 0.0
    return 1.0 - math.sqrt((r - 1) ** 2 + (alpha - 1) ** 2 + (beta - 1) ** 2)


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Create ML features from raw time series."""
    feat = df.copy()

    # Lagged water levels
    for lag in [1, 2, 3, 7, 14]:
        feat[f"level_lag_{lag}"] = feat["water_level_cm"].shift(lag)

    # Rolling precipitation sums
    for window in [3, 7, 14]:
        feat[f"precip_{window}d"] = feat["precipitation_sum"].rolling(window).sum()

    # Rolling temperature
    feat["tmax_3d"] = feat["temperature_2m_max"].rolling(3).mean()
    feat["tmin_3d"] = feat["temperature_2m_min"].rolling(3).mean()
    feat["tmax_7d"] = feat["temperature_2m_max"].rolling(7).mean()

    # Snowmelt proxy: 3-day decrease in snow depth (positive = melting)
    feat["snow_melt_3d"] = -feat["snow_depth_mean"].diff(3)
    feat["snow_melt_7d"] = -feat["snow_depth_mean"].diff(7)

    # Soil moisture change
    feat["soil_moisture_change_7d"] = feat["soil_moisture_0_to_7cm_mean"].diff(7)

    # Water level trend (rate of change)
    feat["level_change_1d"] = feat["water_level_cm"].diff(1)
    feat["level_change_3d"] = feat["water_level_cm"].diff(3)
    feat["level_change_7d"] = feat["water_level_cm"].diff(7)

    # Seasonality (cyclical encoding)
    doy = pd.to_datetime(feat["date"]).dt.dayofyear
    feat["sin_doy"] = np.sin(2 * np.pi * doy / 365.25)
    feat["cos_doy"] = np.cos(2 * np.pi * doy / 365.25)
    feat["month"] = pd.to_datetime(feat["date"]).dt.month

    # Targets: future water levels
    for h in HORIZONS:
        feat[f"target_t{h}"] = feat["water_level_cm"].shift(-h)

    return feat


def get_feature_cols(df: pd.DataFrame) -> list[str]:
    """Get list of feature columns (everything except date, raw target, future targets)."""
    exclude = {"date", "water_level_cm"} | {f"target_t{h}" for h in HORIZONS}
    return [c for c in df.columns if c not in exclude]


def train_station(basin_id: str, df: pd.DataFrame, attrs: dict) -> dict:
    """Train XGBoost models for a single station."""
    print(f"\n{'='*60}")
    print(f"Training: {basin_id} ({len(df)} days)")
    print(f"{'='*60}")

    # Build features
    feat = build_features(df)

    # Drop rows with NaN (from lag/rolling calculations)
    feat = feat.dropna()
    print(f"  After feature engineering: {len(feat)} samples")

    feature_cols = get_feature_cols(feat)
    print(f"  Features: {len(feature_cols)}")

    # Time-based split: 70% train, 15% validation, 15% test
    n = len(feat)
    train_end = int(n * 0.70)
    val_end = int(n * 0.85)

    train = feat.iloc[:train_end]
    val = feat.iloc[train_end:val_end]
    test = feat.iloc[val_end:]

    print(f"  Split: train={len(train)}, val={len(val)}, test={len(test)}")
    print(f"  Train period: {train['date'].iloc[0]} → {train['date'].iloc[-1]}")
    print(f"  Test period:  {test['date'].iloc[0]} → {test['date'].iloc[-1]}")

    results = {"basin_id": basin_id, "n_samples": len(feat), "horizons": {}}

    for h in HORIZONS:
        target_col = f"target_t{h}"

        X_train = train[feature_cols].values
        y_train = train[target_col].values
        X_val = val[feature_cols].values
        y_val = val[target_col].values
        X_test = test[feature_cols].values
        y_test = test[target_col].values

        # XGBoost with early stopping on validation
        dtrain = xgb.DMatrix(X_train, label=y_train, feature_names=feature_cols)
        dval = xgb.DMatrix(X_val, label=y_val, feature_names=feature_cols)
        dtest = xgb.DMatrix(X_test, label=y_test, feature_names=feature_cols)

        params = {
            "objective": "reg:squarederror",
            "eval_metric": "rmse",
            "max_depth": 6,
            "learning_rate": 0.05,
            "subsample": 0.8,
            "colsample_bytree": 0.8,
            "min_child_weight": 5,
            "reg_alpha": 0.1,
            "reg_lambda": 1.0,
            "seed": 42,
            "verbosity": 0,
        }

        model = xgb.train(
            params,
            dtrain,
            num_boost_round=1000,
            evals=[(dval, "val")],
            early_stopping_rounds=50,
            verbose_eval=False,
        )

        # Evaluate on test set
        y_pred = model.predict(dtest)
        rmse = math.sqrt(mean_squared_error(y_test, y_pred))
        nse = compute_nse(y_test, y_pred)
        kge = compute_kge(y_test, y_pred)

        # Peak detection: how well does the model predict above-danger events?
        danger_cm = attrs.get("danger_level_cm", 999)
        actual_peaks = y_test > danger_cm
        predicted_peaks = y_pred > danger_cm
        peak_hits = np.sum(actual_peaks & predicted_peaks)
        peak_total = np.sum(actual_peaks)
        peak_recall = peak_hits / peak_total if peak_total > 0 else float("nan")

        print(f"\n  Horizon t+{h}:")
        print(f"    RMSE:  {rmse:.1f} cm")
        print(f"    NSE:   {nse:.4f}")
        print(f"    KGE:   {kge:.4f}")
        print(f"    Peaks: {peak_hits}/{peak_total} detected (recall={peak_recall:.2%})" if peak_total > 0 else "    Peaks: none in test period")

        # Feature importance (top 10)
        imp = model.get_score(importance_type="gain")
        top_features = sorted(imp.items(), key=lambda x: -x[1])[:10]
        print(f"    Top features: {', '.join(f'{k}({v:.0f})' for k, v in top_features)}")

        # Save model
        model_path = MODEL_DIR / f"{basin_id}_t{h}.json"
        model.save_model(str(model_path))

        results["horizons"][f"t{h}"] = {
            "rmse": round(rmse, 2),
            "nse": round(nse, 4),
            "kge": round(kge, 4),
            "peak_recall": round(peak_recall, 4) if not math.isnan(peak_recall) else None,
            "n_trees": model.best_iteration + 1,
            "best_val_rmse": float(model.best_score),
        }

    return results


def main():
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    # Load station attributes
    attrs_df = pd.read_csv(ATTRS_PATH)
    attrs_by_id = {row["basin_id"]: row.to_dict() for _, row in attrs_df.iterrows()}

    all_results = []

    for csv_path in sorted(DATA_DIR.glob("*.csv")):
        basin_id = csv_path.stem
        df = pd.read_csv(csv_path)

        if len(df) < 100:
            print(f"SKIP {basin_id}: only {len(df)} rows")
            continue

        attrs = attrs_by_id.get(basin_id, {})
        result = train_station(basin_id, df, attrs)
        all_results.append(result)

    # Save results summary
    results_path = MODEL_DIR / "evaluation_results.json"
    with open(results_path, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"\nResults saved to {results_path}")

    # Print summary table
    print(f"\n{'='*70}")
    print("SUMMARY")
    print(f"{'='*70}")
    print(f"{'Station':<20} {'t+1 NSE':>10} {'t+3 NSE':>10} {'t+7 NSE':>10} {'t+1 RMSE':>10}")
    print("-" * 70)
    for r in all_results:
        h1 = r["horizons"].get("t1", {})
        h3 = r["horizons"].get("t3", {})
        h7 = r["horizons"].get("t7", {})
        print(f"{r['basin_id']:<20} {h1.get('nse', 'N/A'):>10} {h3.get('nse', 'N/A'):>10} {h7.get('nse', 'N/A'):>10} {h1.get('rmse', 'N/A'):>10}")


if __name__ == "__main__":
    main()
