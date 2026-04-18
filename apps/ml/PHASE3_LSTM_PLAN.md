# Phase 3 — NeuralHydrology EA-LSTM Model

## Current State (as of 2026-04-12)

Phases 1-2, 4-7 are **complete and deployed** to production (72.56.8.247).
Phase 3 (LSTM) is next.

---

## XGBoost Baseline Performance (what we're trying to beat)

| Station | t+1 NSE | t+3 NSE | t+7 NSE | Samples |
|---------|---------|---------|---------|---------|
| samur_ahty | **0.990** | 0.960 | 0.933 | 3,854 |
| samur_usuhchaj | **0.964** | 0.925 | 0.881 | 8,040 |
| samur_luchek | **0.908** | 0.826 | 0.749 | 4,362 |
| sulak_sulak | **0.888** | 0.391 | 0.233 | 4,362 |
| sulak_yazykovka | **0.721** | 0.414 | 0.015 | 4,362 |
| sulak_miatly | **0.322** | -0.196 | -0.485 | 4,362 |

**Samur rivers**: excellent. **Sulak rivers**: poor at longer horizons.
LSTM should improve Sulak — its temporal memory captures reservoir-regulated dynamics that XGBoost's static lag features miss.

---

## Research Findings

### NeuralHydrology Framework
- **Version**: v1.13.0 (released 2026-01-14)
- **Repository**: https://github.com/neuralhydrology/neuralhydrology
- **License**: BSD-3-Clause
- **Requirements**: Python >= 3.10, PyTorch (any recent version)
- **Key deps**: numpy, pandas, xarray, netcdf4, h5py, numba, scipy, tensorboard, tqdm, ruamel.yaml
- **Install**: `pip install neuralhydrology`
- **CPU training**: fully supported via `device: cpu` — feasible for our tiny 6-basin dataset
- **CLI**: `nh-run train`, `nh-run finetune`, `nh-run evaluate`

### Corrections to Original Plan
1. **`GaussianNLLLoss` doesn't exist in NeuralHydrology** — use **GMM head** (Gaussian Mixture Model) or **MC Dropout** for probabilistic output
2. **GenericDataset needs netCDF files, not CSV** — each station needs a `.nc` file with a `date` coordinate
3. **`finetune_modules: [head, lstm]`** is wrong for EA-LSTM — correct modules: `[head, dynamic_gates, input_gate, embedding_net]`
4. **"Never train on a single basin" (Kratzert et al., HESS 2024)** — training LSTM on 6 stations alone is scientifically questionable; CAMELS pretraining is essential, not optional
5. **CAMELS-US dataset is ~15GB** — significant download but required
6. **Google's 2024 Nature paper** used encoder-decoder LSTM, not EA-LSTM — for daily prediction, EA-LSTM is more appropriate

### EA-LSTM Architecture (neuralhydrology/modelzoo/ealstm.py)
- **Input gate**: controlled ONLY by static features (catchment attributes) — per-basin "fingerprint"
- **Forget/cell/output gates**: use dynamic (time series) inputs
- Static features → embedding network → linear layer → input gate activations
- Dynamic features → separate embedding network

Key config:
```yaml
model: ealstm
hidden_size: 128
initial_forget_bias: 3
output_dropout: 0.4
seq_length: 365
predict_last_n: 1
batch_size: 256
epochs: 30
```

### GenericDataset Format
```
data_dir/
  time_series/
    station_001.nc    # one netCDF per basin (date coordinate + data variables)
    station_002.nc
  attributes/
    static_attrs.csv  # indexed by basin_id, columns are static features
```

- NetCDF: single `date` coordinate (datetime), all dynamic vars as data variables
- Missing values MUST be NaN
- Training: sequences with NaN inputs/targets are automatically skipped
- Basin file: plain text, one basin_id per line

### Probabilistic Output Options
- **GMM head** (recommended): `head: gmm`, `n_distributions: 3` — outputs mean + variance + weight per component
- **CMAL head**: better for skewed distributions (floods are right-skewed)
- **UMAL head**: approximates full quantile function, most flexible
- **MC Dropout**: simplest — `mc_dropout: True`, run inference multiple times

### Fine-Tuning Support
```yaml
base_run_dir: ./runs/pretrain_camels_ealstm_DDMMYYYY_HHMMSS
finetune_modules: [head, dynamic_gates, input_gate]
epochs: 10        # much fewer than pretraining
learning_rate:
  0: 1e-4         # much smaller than pretraining
  5: 1e-5
```

**Caveat from docs**: "Finetuning can be a tedious task and is usually very sensitive to the learning rate as well as the number of epochs."

### CAMELS-US Dataset
- **Download**: https://ral.ucar.edu/solutions/products/camels
- **Size**: ~15GB compressed, ~130GB uncompressed
- **Coverage**: 671 watersheds, contiguous USA, 1980-2014
- **Contents**: daily meteorological forcings (Daymet, Maurer, NLDAS) + USGS streamflow + 27 categories of static attributes
- **Alternative**: Caravan dataset (6,830+ basins globally, includes CAMELS-US)

### Cross-Continent Transfer Learning
- Studies show transfer from US/Amazon to Mekong/Kenya/Myanmar improves NSE from 0.65 to 0.82+
- Static attributes (catchment area, elevation, climate indices) help the model adapt
- Google's global model (5,680 basins worldwide) generalizes to ungauged watersheds
- Our Dagestan rivers are different climate (continental mountain + semi-arid lowland) but the universal rainfall-runoff physics transfers

### Google's 2024 Nature Paper
- **Title**: "Global prediction of extreme floods in ungauged watersheds" (Nature 627, 559-563)
- **Architecture**: Encoder LSTM (256 hidden, 365-day history) + Decoder LSTM (256 hidden, 7-day forecast)
- **Loss**: negative log-likelihood of asymmetric Laplacian distribution
- **Training**: 50,000 minibatches, batch 256, 5,680 gauges, ~10 hours on V100
- **Result**: 5-day AI forecasts matched or exceeded GloFAS same-day nowcasts

### Training Time Estimates (our 6 basins)
- Total samples: ~29,000 (minus seq_length warmup)
- At batch_size 256: ~113 batches/epoch
- CAMELS pretraining (671 basins): ~1-2 hours on CPU
- Dagestan fine-tuning: ~5 minutes on CPU
- No GPU required

---

## Implementation Plan

### Step 3.0 — Environment Setup
- Install `neuralhydrology>=1.13` + `torch` (CPU-only) in ML service
- Create separate training requirements file or extend existing one
- New deps: `neuralhydrology`, `torch`, `xarray`, `netcdf4`
- PyTorch CPU wheel adds ~600MB to Docker image

### Step 3.1 — Data Conversion (CSV → netCDF)
**New file**: `apps/ml/scripts/prepare_nh_data.py`

Convert 6 CSV files to NeuralHydrology GenericDataset format:
```
apps/ml/data/nh_dataset/
  time_series/
    samur_usuhchaj.nc
    samur_ahty.nc
    samur_luchek.nc
    sulak_miatly.nc
    sulak_yazykovka.nc
    sulak_sulak.nc
  attributes/
    attributes.csv
  basins_train.txt
  basins_val.txt
  basins_test.txt
```

Time splits:
- **Train**: 2001–2016 (~16 years)
- **Validation**: 2017–2019 (~3 years)
- **Test**: 2020–2024 (~4-5 years)

Dynamic inputs (from CSV columns):
- precipitation_sum, temperature_2m_max, temperature_2m_min
- snowfall_sum, snow_depth_mean, soil_moisture_0_to_7cm_mean
- et0_fao_evapotranspiration, rain_sum

Target variable: water_level_cm

Static attributes (from attributes.csv):
- area_km2, elevation_m, mean_discharge_m3s, danger_level_cm, lat, lng

### Step 3.2 — CAMELS-US Download & Pretraining
**New files**: `apps/ml/scripts/download_camels.py`, `apps/ml/configs/pretrain_camels.yml`

```yaml
# pretrain_camels.yml
experiment_name: pretrain_camels_ealstm
run_dir: ./runs
device: cpu

# Data
dataset: camels_us
data_dir: ./data/camels_us
forcings: daymet
train_basin_file: ./data/camels_us/basin_list.txt
train_start_date: "01/10/1980"
train_end_date: "30/09/2000"
validation_basin_file: ./data/camels_us/basin_list.txt
validation_start_date: "01/10/2000"
validation_end_date: "30/09/2010"

# Model
model: ealstm
hidden_size: 128
initial_forget_bias: 3
seq_length: 365
output_dropout: 0.4
predict_last_n: 1

# Dynamic inputs
dynamic_inputs:
  - prcp(mm/day)
  - srad(W/m2)
  - tmax(C)
  - tmin(C)
  - vp(Pa)

# Static inputs
camels_attributes:
  - elev_mean
  - slope_mean
  - area_gages2
  - frac_forest
  - lai_max
  - lai_diff
  - gvf_max
  - soil_depth_pelletier
  - sand_frac
  - clay_frac
  - carbonate_rocks_frac
  - p_mean
  - pet_mean
  - aridity
  - frac_snow
  - high_prec_freq
  - low_prec_dur

# Target
target_variables:
  - QObs(mm/d)

# Training
loss: NSE
optimizer: Adam
learning_rate:
  0: 0.001
  10: 0.0005
  20: 0.0001
batch_size: 256
epochs: 30
clip_gradient_norm: 1.0
```

### Step 3.3 — Dagestan Fine-Tuning
**New file**: `apps/ml/configs/finetune_dagestan.yml`

```yaml
# finetune_dagestan.yml
experiment_name: finetune_dagestan_ealstm
run_dir: ./runs
device: cpu

# Fine-tuning from pretrained
base_run_dir: ./runs/pretrain_camels_ealstm_XXXXXXXX_XXXXXX
finetune_modules:
  - head
  - dynamic_gates
  - input_gate

# Data
dataset: generic
data_dir: ./data/nh_dataset
train_basin_file: ./data/nh_dataset/basins_train.txt
train_start_date: "01/01/2001"
train_end_date: "31/12/2016"
validation_basin_file: ./data/nh_dataset/basins_val.txt
validation_start_date: "01/01/2017"
validation_end_date: "31/12/2019"
test_basin_file: ./data/nh_dataset/basins_test.txt
test_start_date: "01/01/2020"
test_end_date: "31/12/2024"

# Model (must match pretrained)
model: ealstm
hidden_size: 128
seq_length: 365
predict_last_n: 1
output_dropout: 0.4

# Probabilistic output
head: gmm
n_distributions: 3
n_samples: 100

# Dynamic inputs
dynamic_inputs:
  - precipitation_sum
  - temperature_2m_max
  - temperature_2m_min
  - snowfall_sum
  - snow_depth_mean
  - soil_moisture_0_to_7cm_mean
  - et0_fao_evapotranspiration
  - rain_sum

# Static inputs
static_attributes:
  - area_km2
  - elevation_m
  - mean_discharge_m3s
  - danger_level_cm
  - lat
  - lng

# Target
target_variables:
  - water_level_cm

# Training (conservative for fine-tuning)
loss: GMMLoss
optimizer: Adam
learning_rate:
  0: 0.0001
  5: 0.00005
  10: 0.00001
batch_size: 64
epochs: 20
clip_gradient_norm: 1.0
target_noise_std: 0.01
```

### Step 3.4 — Evaluation & Comparison
**New file**: `apps/ml/scripts/evaluate_lstm.py`

- Run EA-LSTM on test period (2020-2024) via `nh-run evaluate`
- Compute NSE, KGE, RMSE per station per horizon (t+1, t+3, t+7)
- Compare against XGBoost baseline (from evaluation_results.json)
- Calibration check: do 90% confidence intervals contain ~90% of observations?
- Generate side-by-side comparison plots
- Output: `apps/ml/models/lstm_evaluation_results.json`

### Step 3.5 — Inference Integration
**Modify**: `apps/ml/app/predict.py`

- Add LSTM inference path alongside XGBoost
- Load PyTorch model weights on startup
- Accept `model: "lstm"` in predict request
- Build 365-day input sequence from recent data
- Run forward pass → extract mean + variance from GMM head
- Convert variance to calibrated confidence bands
- Fallback to XGBoost if LSTM unavailable

### Step 3.6 — Docker & Deployment
- Update `apps/ml/Dockerfile` to include PyTorch CPU + NeuralHydrology
- Image size: ~200MB → ~800MB (PyTorch adds ~600MB)
- Multi-stage build to minimize final image
- Export trained LSTM weights to `apps/ml/models/lstm/`
- Update health endpoint to report both model types
- Update scheduler: use LSTM as primary, XGBoost as fallback

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| LSTM underperforms XGBoost on Samur (already NSE>0.96) | Low | Keep XGBoost as fallback, use best-per-station |
| 6 stations too few for LSTM generalization | High | CAMELS pretraining provides universal rainfall-runoff knowledge |
| CAMELS→Dagestan transfer fails (different climate) | Medium | Cross-continent transfer shown effective in literature; static attributes help |
| PyTorch bloats Docker image (+600MB) | Low | CPU-only wheel, multi-stage build |
| Training data has gaps (water_level_cm NaN) | Low | NeuralHydrology skips NaN sequences automatically |
| Fine-tuning overfits on 6 basins | Medium | Conservative LR, few epochs, high dropout, target noise |

---

## Files Summary

| File | Action |
|------|--------|
| `apps/ml/scripts/prepare_nh_data.py` | **New** — CSV→netCDF conversion |
| `apps/ml/scripts/download_camels.py` | **New** — CAMELS-US downloader |
| `apps/ml/scripts/train_lstm.py` | **New** — training wrapper script |
| `apps/ml/scripts/evaluate_lstm.py` | **New** — evaluation + comparison |
| `apps/ml/configs/pretrain_camels.yml` | **New** — CAMELS pretraining config |
| `apps/ml/configs/finetune_dagestan.yml` | **New** — Dagestan fine-tuning config |
| `apps/ml/app/predict.py` | **Modify** — add LSTM inference path |
| `apps/ml/app/main.py` | **Modify** — load LSTM models on startup |
| `apps/ml/app/schemas.py` | **Modify** — add "lstm" model option |
| `apps/ml/requirements.txt` | **Modify** — add neuralhydrology, torch, xarray, netcdf4 |
| `apps/ml/Dockerfile` | **Modify** — include PyTorch CPU |

---

## References

- [NeuralHydrology Docs](https://neuralhydrology.readthedocs.io/en/latest/)
- [NeuralHydrology GitHub](https://github.com/neuralhydrology/neuralhydrology)
- [EA-LSTM Paper (Kratzert et al., 2019)](https://doi.org/10.5194/hess-23-5089-2019)
- [Google Nature 2024 — Global Flood Prediction](https://www.nature.com/articles/s41586-024-07145-1)
- ["Never Train on a Single Basin" (HESS 2024)](https://hess.copernicus.org/articles/28/4187/2024/)
- [CAMELS-US Dataset](https://ral.ucar.edu/solutions/products/camels)
- [Caravan Global Dataset](https://github.com/kratzert/Caravan)
- [GenericDataset API Docs](https://neuralhydrology.readthedocs.io/en/latest/api/neuralhydrology.datasetzoo.genericdataset.html)
- [Fine-tuning Tutorial](https://neuralhydrology.readthedocs.io/en/latest/tutorials/finetuning.html)
