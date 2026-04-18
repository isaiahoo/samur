# Phase 3 — EA-LSTM Training Status

## Last Updated: 2026-04-13

## Current Status: PRETRAINING COMPLETE — Fine-tuning ready to launch

### GPU Server: dslab.tech (RTX 3090, 24 GB VRAM)
- Pretraining completed: 15 epochs, **Median NSE 0.743, KGE 0.753**
- Pretrained weights saved: `runs/pretrain_camels_ealstm_1304_124258/model_epoch015.pt`
- CAMELS-US data + NH dataset already on server
- NeuralHydrology 1.13.0 installed in conda env `nh`

### What's on the GPU server (dslab.tech):
- `~/apps/ml/` — full ML directory
- `~/apps/ml/runs/pretrain_camels_ealstm_1304_124258/` — pretrained model (critical!)
- `~/apps/ml/data/camels_us/` — CAMELS-US dataset (17 GB)
- `~/apps/ml/data/nh_dataset/` — Dagestan netCDF data (6 stations)
- conda env `nh` with PyTorch + NeuralHydrology

### Next steps when resuming:
1. Get fresh SSH credentials from dslab.tech (tokens expire ~15 min)
2. Transfer updated `scripts/train_lstm.py` and `configs/finetune_dagestan.yml` to server
3. Run: `conda activate nh && nohup python scripts/train_lstm.py finetune --device cuda:0 > finetune.log 2>&1 &`
4. Fine-tuning should take ~5-10 min on RTX 3090
5. Evaluate, export, deploy

---

## What's DONE (Steps 3.0–3.2 partial)

### Step 3.0 — Environment Setup (COMPLETE)
- Python venv at `apps/ml/.venv/` (Python 3.13, local Mac only)
- Installed: PyTorch 2.11.0, NeuralHydrology 1.13.0, xarray, netCDF4, h5py
- All imports verified working: EALSTM, GenericDataset, start_run
- Directory structure created: `data/nh_dataset/`, `data/camels_us/`, `runs/`, `models/lstm/`
- `.gitignore` updated for: `.venv/`, `runs/`, `nh_dataset/`, `camels_us/`
- Created `requirements-train.txt` with all training dependencies

### Step 3.1 — Data Conversion CSV→netCDF (COMPLETE)
- Script: `apps/ml/scripts/prepare_nh_data.py`
- 6 stations converted to netCDF in `data/nh_dataset/time_series/`
- Static attributes reformatted in `data/nh_dataset/attributes/attributes.csv`
- Basin list files: `basins.txt`, `basins_train.txt`, `basins_val.txt`, `basins_test.txt`
- All 6 basins in all splits (NeuralHydrology uses date ranges, not basin lists, for splitting)
- Time splits:
  - Train: 2008-01-01 .. 2015-12-31
  - Val: 2016-01-01 .. 2017-12-31
  - Test: 2018-01-01 .. 2019-12-31
- Data ranges per station:
  - samur_usuhchaj: 8524 days (2001–2024), 5.4% NaN
  - samur_ahty: 3875 days (2008–2018), 0% NaN
  - samur_luchek: 4383 days (2008–2019), 0% NaN
  - sulak_miatly: 4383 days (2008–2019), 0% NaN
  - sulak_yazykovka: 4383 days (2008–2019), 0% NaN
  - sulak_sulak: 4383 days (2008–2019), 0% NaN

### Step 3.2 — CAMELS Download + Pretraining (COMPLETE)
- **CAMELS-US downloaded and extracted** on GPU server (17 GB at `data/camels_us/`)
  - Source: Zenodo (GDEX is dead) — `https://zenodo.org/records/15529996/files/`
  - 677 forcing files (daymet), 674 streamflow files, 7 attribute files
  - 531-basin list from NeuralHydrology examples
- **Pretraining COMPLETE on dslab.tech RTX 3090:**
  - 15 epochs, batch_size=512, ~6 hours total
  - Final validation: **Median NSE 0.743, KGE 0.753** (good baseline)
  - Weights: `runs/pretrain_camels_ealstm_1304_124258/model_epoch015.pt`
  - Config: `configs/pretrain_camels.yml` (epochs=15, batch_size=512, num_workers=4)
- **Fine-tuning bug fixed:** `nh_finetune()` fails with scaler mismatch (CAMELS vs Dagestan feature names). Fixed by using `start_run()` with monkey-patched weight injection — transfers compatible LSTM hidden weights while creating fresh Dagestan scaler.
- **Training wrapper script:** `scripts/train_lstm.py` (pretrain/finetune/evaluate/export subcommands)
- **GPU setup script:** `scripts/setup_gpu_server.sh`

---

## Critical Bug Fixes Found During Setup

1. **`swe(mm)` column is entirely NaN** for many CAMELS basins → removed from `dynamic_inputs` in pretrain config. Without this fix, ALL samples are invalid and training fails with `NoTrainDataError`.

2. **`GaussianNLLLoss` doesn't exist** in NeuralHydrology — original plan was wrong. Using `head: regression` for pretraining, will use `head: gmm` for fine-tuning (probabilistic output).

3. **`camels_attributes` config key is deprecated** — use `static_attributes` instead.

4. **GDEX download URLs are dead** — migrated to Zenodo. Updated `download_camels.py` with working URLs.

5. **Attribute files not available as zip on Zenodo** — must download 7 individual `.txt` files. Script handles this.

---

## Files Created/Modified This Session

### New Files
| File | Purpose |
|------|---------|
| `apps/ml/requirements-train.txt` | Training Python dependencies |
| `apps/ml/scripts/prepare_nh_data.py` | CSV → netCDF conversion for NeuralHydrology |
| `apps/ml/scripts/download_camels.py` | CAMELS-US downloader (Zenodo URLs) |
| `apps/ml/scripts/train_lstm.py` | Training wrapper (pretrain/finetune/evaluate/export) |
| `apps/ml/scripts/setup_gpu_server.sh` | GPU server environment setup |
| `apps/ml/configs/pretrain_camels.yml` | CAMELS EA-LSTM pretraining config |
| `apps/ml/configs/finetune_dagestan.yml` | Dagestan fine-tuning config |
| `apps/ml/PHASE3_LSTM_PLAN.md` | Full Phase 3 plan with research findings |

### Modified Files
| File | Change |
|------|--------|
| `.gitignore` | Added: `apps/ml/data/nh_dataset/`, `apps/ml/data/camels_us/`, `apps/ml/runs/`, `apps/ml/.venv/` |

### Generated Data (gitignored, on local Mac)
| Path | Size | Description |
|------|------|-------------|
| `apps/ml/data/nh_dataset/` | 1.4 MB | 6 netCDF files + attributes + basin lists |
| `apps/ml/data/camels_us/` | 17 GB | Full CAMELS-US (forcings + streamflow + attributes) |
| `apps/ml/.venv/` | ~2 GB | Python venv with PyTorch + NeuralHydrology |

---

## What Needs to Happen Next

### Immediate: Get GPU Access
User needs to provide SSH credentials for a machine with NVIDIA GPU (RTX).

### On GPU Server (Steps 3.2–3.4)
```bash
# 1. Transfer or clone the repo
git clone <repo> && cd apps/ml

# 2. Setup environment
bash scripts/setup_gpu_server.sh

# 3. Download CAMELS (3.4 GB, ~5 min)
python scripts/download_camels.py

# 4. Prepare Dagestan netCDF data
python scripts/prepare_nh_data.py

# 5. Pretrain on CAMELS (~15 min on RTX)
python scripts/train_lstm.py pretrain --device cuda:0

# 6. Fine-tune on Dagestan (~2 min on RTX)
python scripts/train_lstm.py finetune --device cuda:0

# 7. Evaluate
python scripts/train_lstm.py evaluate --run-dir runs/<finetune_run> --period test

# 8. Export weights
python scripts/train_lstm.py export --run-dir runs/<finetune_run>
```

### After Training (Steps 3.5–3.6, back on local)
- Copy `models/lstm/` weights back to local
- Modify `apps/ml/app/predict.py` — add LSTM inference path alongside XGBoost
- Update `apps/ml/app/main.py` — load both model types
- Update `apps/ml/Dockerfile` — add PyTorch CPU + NeuralHydrology
- Deploy to production (72.56.8.247)

---

## Config Details (for reference)

### Pretrain Config Key Settings
```yaml
dataset: camels_us
model: ealstm
hidden_size: 128
seq_length: 365
head: regression
loss: NSE
epochs: 30
batch_size: 256
dynamic_inputs: [prcp(mm/day), srad(W/m2), tmax(C), tmin(C), vp(Pa), dayl(s)]
# NOTE: swe(mm) deliberately excluded — all NaN for many basins
static_attributes: [elev_mean, slope_mean, area_gages2, frac_forest, ...]
```

### Finetune Config Key Settings
```yaml
dataset: generic
model: ealstm
hidden_size: 128
seq_length: 365
head: regression  # change to gmm for probabilistic
loss: NSE
epochs: 20
batch_size: 64
learning_rate: {0: 0.0001, 10: 0.00005, 15: 0.00001}
finetune_modules: [head, dynamic_gates, input_gate]
dynamic_inputs: [precipitation_sum, temperature_2m_max, temperature_2m_min, snowfall_sum, snow_depth_mean, soil_moisture_0_to_7cm_mean, et0_fao_evapotranspiration, rain_sum]
static_attributes: [area_km2, elevation_m, mean_discharge_m3s, danger_level_cm, lat, lng]
target_variables: [water_level_cm]
```

---

## XGBoost Baseline (what LSTM needs to beat)

| Station | t+1 NSE | t+3 NSE | t+7 NSE |
|---------|---------|---------|---------|
| samur_ahty | 0.990 | 0.960 | 0.933 |
| samur_usuhchaj | 0.964 | 0.925 | 0.881 |
| samur_luchek | 0.908 | 0.826 | 0.749 |
| sulak_sulak | 0.888 | 0.391 | 0.233 |
| sulak_yazykovka | 0.721 | 0.414 | 0.015 |
| sulak_miatly | 0.322 | -0.196 | -0.485 |

**Primary goal**: Beat XGBoost on weak Sulak stations while maintaining Samur performance.
