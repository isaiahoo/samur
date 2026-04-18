#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""
Download CAMELS-US dataset for EA-LSTM pretraining.

Downloads from Zenodo (migrated from NCAR/GDEX):
  - basin_timeseries_v1p2_metForcing_obsFlow.zip  (~3.4 GB, forcings + streamflow)
  - Individual attribute txt files                  (~2 MB total)
  - 531-basin list from NeuralHydrology examples

Expected output structure (what NeuralHydrology needs):
  data/camels_us/
    basin_mean_forcing/
      daymet/  (18 HUC subdirectories with forcing files)
    usgs_streamflow/   (18 HUC subdirectories with discharge files)
    camels_attributes_v2.0/  (attribute txt files)
    basin_list_531.txt       (standard 531-basin subset)

Usage:
  python scripts/download_camels.py
  python scripts/download_camels.py --data-dir ./data/camels_us
"""

import argparse
import os
import shutil
import sys
import zipfile
from pathlib import Path

try:
    import httpx
except ImportError:
    print("ERROR: httpx not installed. Run: pip install httpx")
    sys.exit(1)

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_DATA_DIR = SCRIPT_DIR.parent / "data" / "camels_us"

# Zenodo URLs (GDEX is dead as of 2025+)
ZENODO_BASE = "https://zenodo.org/records/15529996/files"

FORCINGS_URL = f"{ZENODO_BASE}/basin_timeseries_v1p2_metForcing_obsFlow.zip?download=1"
FORCINGS_FILENAME = "basin_timeseries_v1p2_metForcing_obsFlow.zip"

# Individual attribute files (no zip available on Zenodo)
ATTRIBUTE_FILES = [
    "camels_clim.txt",
    "camels_geol.txt",
    "camels_hydro.txt",
    "camels_name.txt",
    "camels_soil.txt",
    "camels_topo.txt",
    "camels_vege.txt",
]

# 531-basin list from NeuralHydrology examples
BASIN_LIST_URL = "https://raw.githubusercontent.com/neuralhydrology/neuralhydrology/master/examples/06-Finetuning/531_basin_list.txt"


def download_file(url: str, dest: Path, desc: str = "") -> bool:
    """Download a file with progress display."""
    if dest.exists():
        size_mb = dest.stat().st_size / (1024 * 1024)
        print(f"  Already exists: {dest.name} ({size_mb:.1f} MB), skipping")
        return True

    print(f"  Downloading: {desc or dest.name}")
    print(f"  URL: {url[:100]}...")

    try:
        with httpx.stream("GET", url, follow_redirects=True, timeout=600) as resp:
            resp.raise_for_status()
            total = int(resp.headers.get("content-length", 0))
            total_mb = total / (1024 * 1024) if total else 0

            downloaded = 0
            with open(dest, "wb") as f:
                for chunk in resp.iter_bytes(chunk_size=1024 * 1024):
                    f.write(chunk)
                    downloaded += len(chunk)
                    mb = downloaded / (1024 * 1024)
                    if total:
                        pct = downloaded / total * 100
                        print(f"\r  {mb:.0f}/{total_mb:.0f} MB ({pct:.0f}%)", end="", flush=True)
                    else:
                        print(f"\r  {mb:.0f} MB", end="", flush=True)
            print()
        return True
    except Exception as e:
        print(f"\n  ERROR downloading {dest.name}: {e}")
        if dest.exists():
            dest.unlink()
        return False


def extract_zip(zip_path: Path, extract_to: Path, desc: str = "") -> bool:
    """Extract a zip file."""
    print(f"  Extracting: {desc or zip_path.name}...")
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(extract_to)
        print(f"  Extracted to {extract_to}")
        return True
    except Exception as e:
        print(f"  ERROR extracting {zip_path.name}: {e}")
        return False


def reorganize_forcings(data_dir: Path):
    """
    After extraction, the forcings zip creates a nested structure like:
      basin_dataset_public_v1p2/basin_mean_forcing/daymet/...
      basin_dataset_public_v1p2/usgs_streamflow/...
    Move these up to data_dir level where NeuralHydrology expects them.
    """
    nested = data_dir / "basin_dataset_public_v1p2"
    if not nested.exists():
        candidates = list(data_dir.glob("basin_dataset*"))
        if candidates:
            nested = candidates[0]
        else:
            print("  Forcings already in correct location or unknown structure")
            return

    print(f"  Reorganizing: {nested.name}/ -> {data_dir.name}/")

    for item in nested.iterdir():
        dest = data_dir / item.name
        if dest.exists():
            print(f"    Skipping {item.name} (already exists)")
            continue
        shutil.move(str(item), str(dest))
        print(f"    Moved {item.name}")

    if nested.exists() and not any(nested.iterdir()):
        nested.rmdir()


def download_attributes(data_dir: Path) -> bool:
    """Download individual attribute txt files from Zenodo."""
    attrs_dir = data_dir / "camels_attributes_v2.0"
    attrs_dir.mkdir(parents=True, exist_ok=True)

    all_ok = True
    for filename in ATTRIBUTE_FILES:
        dest = attrs_dir / filename
        if dest.exists():
            print(f"  Already exists: {filename}, skipping")
            continue
        url = f"{ZENODO_BASE}/{filename}?download=1"
        if not download_file(url, dest, filename):
            all_ok = False

    return all_ok


def download_basin_list(data_dir: Path):
    """Download the standard 531-basin list."""
    dest = data_dir / "basin_list_531.txt"
    if dest.exists():
        lines = dest.read_text().strip().split("\n")
        if len(lines) > 100:
            print(f"  Basin list already exists ({len(lines)} basins)")
            return

    print("  Downloading 531-basin list from NeuralHydrology...")
    try:
        resp = httpx.get(BASIN_LIST_URL, follow_redirects=True, timeout=30)
        resp.raise_for_status()
        basins = [b.strip() for b in resp.text.strip().split("\n") if b.strip()]
        with open(dest, "w") as f:
            for b in basins:
                f.write(b + "\n")
        print(f"  Saved {len(basins)} basins to {dest.name}")
    except Exception as e:
        print(f"  ERROR: Could not download basin list: {e}")
        sys.exit(1)


def verify_structure(data_dir: Path) -> bool:
    """Verify the CAMELS data is in the expected structure."""
    print("\nVerifying directory structure...")
    ok = True

    checks = [
        ("basin_mean_forcing/daymet", "Daymet forcings"),
        ("usgs_streamflow", "USGS streamflow"),
        ("camels_attributes_v2.0", "Catchment attributes"),
    ]

    for subdir, desc in checks:
        path = data_dir / subdir
        if path.exists():
            n_files = sum(1 for _ in path.rglob("*.txt"))
            print(f"  OK: {desc} ({n_files} files)")
        else:
            print(f"  MISSING: {desc} ({path})")
            ok = False

    basin_list = data_dir / "basin_list_531.txt"
    if basin_list.exists():
        n = len(basin_list.read_text().strip().split("\n"))
        print(f"  OK: Basin list ({n} basins)")
    else:
        print(f"  MISSING: Basin list")
        ok = False

    return ok


def main():
    parser = argparse.ArgumentParser(description="Download CAMELS-US dataset for NeuralHydrology")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR,
                        help=f"Output directory (default: {DEFAULT_DATA_DIR})")
    parser.add_argument("--skip-forcings", action="store_true",
                        help="Skip the large forcings download (attributes only)")
    parser.add_argument("--verify-only", action="store_true",
                        help="Only verify existing directory structure")
    args = parser.parse_args()

    data_dir = args.data_dir.resolve()
    data_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("CAMELS-US Dataset Download (from Zenodo)")
    print(f"Output: {data_dir}")
    print("=" * 60)

    if args.verify_only:
        ok = verify_structure(data_dir)
        sys.exit(0 if ok else 1)

    # 1. Download attributes (small, fast — individual txt files)
    print("\n1. Catchment attributes...")
    download_attributes(data_dir)

    # 2. Download forcings + streamflow (large)
    if not args.skip_forcings:
        print("\n2. Forcings + streamflow (~3.4 GB download)...")
        forcings_zip = data_dir / FORCINGS_FILENAME
        if download_file(FORCINGS_URL, forcings_zip, "Forcings + streamflow (~3.4 GB)"):
            if not (data_dir / "basin_mean_forcing").exists():
                extract_zip(forcings_zip, data_dir, "forcings + streamflow")
                reorganize_forcings(data_dir)
    else:
        print("\n2. Skipping forcings download (--skip-forcings)")

    # 3. Basin list
    print("\n3. Basin list...")
    download_basin_list(data_dir)

    # 4. Verify
    ok = verify_structure(data_dir)
    if ok:
        print("\nCAMELS-US ready for NeuralHydrology pretraining!")
    else:
        print("\nWARNING: Some components missing. Check errors above.")

    print(f"\nTip: Delete {FORCINGS_FILENAME} after extraction to save ~3.4 GB.")


if __name__ == "__main__":
    main()
