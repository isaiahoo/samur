#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""
Convert per-station CSVs to NeuralHydrology GenericDataset format (netCDF).

Reads:  apps/ml/data/time_series/{station}.csv
        apps/ml/data/attributes.csv

Writes: apps/ml/data/nh_dataset/time_series/{station}.nc
        apps/ml/data/nh_dataset/attributes/attributes.csv
        apps/ml/data/nh_dataset/basins.txt           (all basins)
        apps/ml/data/nh_dataset/basins_train.txt
        apps/ml/data/nh_dataset/basins_val.txt
        apps/ml/data/nh_dataset/basins_test.txt

Time splits (based on data availability across all 6 stations):
  Train: 2008-01-01 .. 2015-12-31
  Val:   2016-01-01 .. 2017-12-31
  Test:  2018-01-01 .. 2019-12-31
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr

SCRIPT_DIR = Path(__file__).resolve().parent
ML_DIR = SCRIPT_DIR.parent
DATA_DIR = ML_DIR / "data"
CSV_DIR = DATA_DIR / "time_series"
NH_DIR = DATA_DIR / "nh_dataset"

BASINS = [
    "samur_usuhchaj",
    "samur_ahty",
    "samur_luchek",
    "sulak_miatly",
    "sulak_yazykovka",
    "sulak_sulak",
]

# Dynamic variables expected in the CSV (input features + target)
DYNAMIC_VARS = [
    "precipitation_sum",
    "temperature_2m_max",
    "temperature_2m_min",
    "snowfall_sum",
    "snow_depth_mean",
    "soil_moisture_0_to_7cm_mean",
    "et0_fao_evapotranspiration",
    "rain_sum",
    "water_level_cm",  # target variable
]

# Static attributes to keep (must match finetune config)
STATIC_ATTRS = [
    "area_km2",
    "elevation_m",
    "mean_discharge_m3s",
    "danger_level_cm",
    "lat",
    "lng",
]


def csv_to_netcdf(basin_id: str) -> bool:
    """Convert a single station CSV to netCDF for NeuralHydrology."""
    csv_path = CSV_DIR / f"{basin_id}.csv"
    if not csv_path.exists():
        print(f"  SKIP {basin_id}: CSV not found at {csv_path}")
        return False

    df = pd.read_csv(csv_path)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").reset_index(drop=True)

    # Fill date gaps with NaN rows (NeuralHydrology expects continuous dates)
    full_dates = pd.date_range(df["date"].min(), df["date"].max(), freq="D")
    df = df.set_index("date").reindex(full_dates).rename_axis("date").reset_index()

    print(f"  {basin_id}: {len(df)} days ({df['date'].min().date()} .. {df['date'].max().date()})")

    # Check which dynamic vars exist in CSV
    available = [v for v in DYNAMIC_VARS if v in df.columns]
    missing = [v for v in DYNAMIC_VARS if v not in df.columns]
    if missing:
        print(f"    WARNING: missing columns {missing}, filling with NaN")
        for col in missing:
            df[col] = np.nan

    # Build xarray Dataset with 'date' as coordinate
    data_vars = {}
    for var in DYNAMIC_VARS:
        data_vars[var] = ("date", df[var].values.astype(np.float32))

    ds = xr.Dataset(
        data_vars=data_vars,
        coords={"date": df["date"].values},
    )

    # Write netCDF
    out_path = NH_DIR / "time_series" / f"{basin_id}.nc"
    ds.to_netcdf(out_path)
    size_kb = out_path.stat().st_size / 1024
    print(f"    -> {out_path.name} ({size_kb:.0f} KB)")
    return True


def prepare_attributes():
    """Copy and reformat attributes CSV for NeuralHydrology."""
    src = DATA_DIR / "attributes.csv"
    if not src.exists():
        print(f"ERROR: attributes.csv not found at {src}")
        return False

    df = pd.read_csv(src)
    # NeuralHydrology expects basin_id as the index
    df = df.set_index("basin_id")

    # Keep only the static attributes we need
    attrs_out = df[STATIC_ATTRS].copy()

    out_path = NH_DIR / "attributes" / "attributes.csv"
    attrs_out.to_csv(out_path)
    print(f"  Attributes: {len(attrs_out)} basins, {len(STATIC_ATTRS)} features -> {out_path.name}")
    return True


def write_basin_files(converted_basins: list[str]):
    """Write basin list files for NeuralHydrology train/val/test splits."""
    # All basins file
    with open(NH_DIR / "basins.txt", "w") as f:
        for b in converted_basins:
            f.write(b + "\n")

    # For fine-tuning with 6 basins: all basins in all splits
    # NeuralHydrology uses date ranges to partition, not basin lists
    for split in ["train", "val", "test"]:
        with open(NH_DIR / f"basins_{split}.txt", "w") as f:
            for b in converted_basins:
                f.write(b + "\n")

    print(f"  Basin files: {len(converted_basins)} basins in train/val/test")


def main():
    print("=" * 60)
    print("Preparing NeuralHydrology GenericDataset")
    print("=" * 60)

    # Ensure output dirs exist
    (NH_DIR / "time_series").mkdir(parents=True, exist_ok=True)
    (NH_DIR / "attributes").mkdir(parents=True, exist_ok=True)

    # Convert CSVs to netCDF
    print("\n1. Converting CSVs to netCDF...")
    converted = []
    for basin_id in BASINS:
        if csv_to_netcdf(basin_id):
            converted.append(basin_id)

    if not converted:
        print("ERROR: No basins converted!")
        sys.exit(1)

    # Prepare attributes
    print("\n2. Preparing static attributes...")
    if not prepare_attributes():
        sys.exit(1)

    # Write basin list files
    print("\n3. Writing basin list files...")
    write_basin_files(converted)

    # Summary
    print("\n" + "=" * 60)
    print(f"Done! {len(converted)}/{len(BASINS)} basins converted.")
    print(f"Output: {NH_DIR}")
    print()
    print("Time splits for config:")
    print("  train: 2008-01-01 .. 2015-12-31")
    print("  val:   2016-01-01 .. 2017-12-31")
    print("  test:  2018-01-01 .. 2019-12-31")
    print()
    print("Directory structure:")
    print(f"  {NH_DIR}/")
    print(f"    time_series/  ({len(converted)} .nc files)")
    print(f"    attributes/   (attributes.csv)")
    print(f"    basins.txt, basins_train.txt, basins_val.txt, basins_test.txt")


if __name__ == "__main__":
    main()
