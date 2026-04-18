#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""
Самур AI — EA-LSTM Training Pipeline

Handles both CAMELS-US pretraining and Dagestan fine-tuning via NeuralHydrology.

Usage:
  # Step 1: Pretrain on CAMELS-US (run from apps/ml/)
  python scripts/train_lstm.py pretrain

  # Step 2: Fine-tune on Dagestan stations
  python scripts/train_lstm.py finetune --base-run runs/pretrain_camels_ealstm_XXXXXXXX_XXXXXX

  # Evaluate a trained model
  python scripts/train_lstm.py evaluate --run-dir runs/<run_name> --period test

  # Train from scratch on Dagestan (no CAMELS pretraining)
  python scripts/train_lstm.py finetune --no-pretrain
"""

import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import torch

SCRIPT_DIR = Path(__file__).resolve().parent
ML_DIR = SCRIPT_DIR.parent


def _finetune_with_pretrained_weights(config_path: Path, pretrain_checkpoint: Path, device: str):
    """Start fresh training on Dagestan data, injecting compatible pretrained LSTM weights.

    NeuralHydrology's built-in finetune() reuses the pretrained scaler, which fails when
    feature names differ (CAMELS vs Dagestan). Instead we:
    1. Monkey-patch the EA-LSTM class to inject pretrained weights after model creation
    2. Call start_run() normally — it creates a fresh scaler for Dagestan features
    3. Only weights with matching names AND shapes are transferred (hidden-to-hidden LSTM
       weights, biases). Input/output projection layers are re-initialized since feature
       dimensions differ between CAMELS (6 dynamic + 24 static) and Dagestan (8 dynamic + 6 static).
    """
    from neuralhydrology.nh_run import start_run

    pretrained_state = torch.load(str(pretrain_checkpoint), map_location=torch.device(device))

    # Handle DataParallel prefix (module.xxx -> xxx)
    cleaned_state = {}
    for key, value in pretrained_state.items():
        clean_key = key.replace("module.", "") if key.startswith("module.") else key
        cleaned_state[clean_key] = value
    pretrained_state = cleaned_state

    # Find the EA-LSTM class to monkey-patch
    try:
        from neuralhydrology.modelzoo.ealstm import EALSTM
        model_class = EALSTM
    except ImportError:
        print("WARNING: Could not import EALSTM, falling back to standard training")
        start_run(config_file=config_path)
        return

    original_init = model_class.__init__

    def _patched_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        # Inject pretrained weights for layers with matching shapes
        model_state = self.state_dict()
        transferred = []
        skipped_shape = []

        for key, value in pretrained_state.items():
            if key in model_state:
                if model_state[key].shape == value.shape:
                    model_state[key] = value
                    transferred.append((key, list(value.shape)))
                else:
                    skipped_shape.append((key, list(value.shape), list(model_state[key].shape)))

        self.load_state_dict(model_state)

        print(f"\n{'='*60}")
        print("Pretrained weight injection report:")
        print(f"{'='*60}")
        print(f"Transferred ({len(transferred)}):")
        for name, shape in transferred:
            print(f"  + {name} {shape}")
        if skipped_shape:
            print(f"Skipped — shape mismatch ({len(skipped_shape)}):")
            for name, pre_shape, tgt_shape in skipped_shape:
                print(f"  x {name}: pretrained {pre_shape} vs target {tgt_shape}")
        print(f"{'='*60}\n")

    # Apply monkey-patch and run training
    model_class.__init__ = _patched_init
    try:
        start_run(config_file=config_path)
    finally:
        model_class.__init__ = original_init


def find_latest_run(run_dir: Path, prefix: str) -> Path | None:
    """Find the most recent run directory matching a prefix."""
    candidates = sorted(run_dir.glob(f"{prefix}_*"), reverse=True)
    return candidates[0] if candidates else None


def pretrain(args):
    """Pretrain EA-LSTM on CAMELS-US."""
    from neuralhydrology.nh_run import start_run

    config_path = ML_DIR / "configs" / "pretrain_camels.yml"
    if not config_path.exists():
        print(f"ERROR: Config not found: {config_path}")
        sys.exit(1)

    # Verify CAMELS data exists
    camels_dir = ML_DIR / "data" / "camels_us"
    if not (camels_dir / "basin_mean_forcing").exists():
        print(f"ERROR: CAMELS-US data not found at {camels_dir}")
        print("Run: python scripts/download_camels.py")
        sys.exit(1)

    print("=" * 60)
    print("Pretraining EA-LSTM on CAMELS-US (531 basins)")
    print(f"Config: {config_path}")
    print(f"Device: {args.device or 'from config'}")
    print("=" * 60)

    # Override device if specified
    if args.device:
        import ruamel.yaml
        yaml = ruamel.yaml.YAML()
        with open(config_path) as f:
            cfg = yaml.load(f)
        cfg["device"] = args.device
        # Write temp config
        tmp_config = ML_DIR / "configs" / "_pretrain_tmp.yml"
        with open(tmp_config, "w") as f:
            yaml.dump(cfg, f)
        config_path = tmp_config

    start_run(config_file=config_path)

    # Clean up temp config
    tmp = ML_DIR / "configs" / "_pretrain_tmp.yml"
    if tmp.exists():
        tmp.unlink()

    # Find the run that was just created
    run = find_latest_run(ML_DIR / "runs", "pretrain_camels_ealstm")
    if run:
        print(f"\nPretraining complete! Run directory: {run}")
        print(f"\nNext step:")
        print(f"  python scripts/train_lstm.py finetune --base-run {run}")


def finetune(args):
    """Fine-tune on Dagestan stations."""
    from neuralhydrology.nh_run import start_run, finetune as nh_finetune

    config_path = ML_DIR / "configs" / "finetune_dagestan.yml"
    if not config_path.exists():
        print(f"ERROR: Config not found: {config_path}")
        sys.exit(1)

    # Verify NeuralHydrology dataset exists
    nh_dir = ML_DIR / "data" / "nh_dataset"
    if not (nh_dir / "time_series").exists():
        print(f"ERROR: NeuralHydrology dataset not found at {nh_dir}")
        print("Run: python scripts/prepare_nh_data.py")
        sys.exit(1)

    print("=" * 60)

    import ruamel.yaml
    yaml = ruamel.yaml.YAML()
    with open(config_path) as f:
        cfg = yaml.load(f)

    # Override device
    if args.device:
        cfg["device"] = args.device

    # Convert relative paths to absolute (NH changes cwd to run dir)
    for key in ["data_dir", "train_basin_file", "validation_basin_file", "test_basin_file"]:
        if key in cfg and not Path(cfg[key]).is_absolute():
            cfg[key] = str(ML_DIR / cfg[key])

    if args.no_pretrain:
        # Train from scratch — remove fine-tuning keys
        print("Training EA-LSTM from scratch on Dagestan (no pretraining)")
        cfg.pop("base_run_dir", None)
        cfg.pop("finetune_modules", None)
        cfg["experiment_name"] = "dagestan_ealstm_scratch"
        cfg["epochs"] = 50
        cfg["learning_rate"] = {0: 0.001, 20: 0.0005, 40: 0.0001}

        tmp_config = ML_DIR / "configs" / "_finetune_tmp.yml"
        with open(tmp_config, "w") as f:
            yaml.dump(cfg, f)

        print(f"Config: {tmp_config}")
        print(f"Device: {cfg.get('device', 'cpu')}")
        print("=" * 60)

        start_run(config_file=tmp_config)
        tmp_config.unlink()
    else:
        # Fine-tune from pretrained
        # NOTE: We use start_run (not nh_finetune) because our Dagestan features
        # have different names than CAMELS features. nh_finetune tries to reuse
        # the pretrained scaler which has CAMELS column names, causing a mismatch.
        # Instead, we train fresh with a new scaler and load pretrained LSTM
        # weights after the run creates the model.
        base_run = args.base_run
        if not base_run:
            base_run = find_latest_run(ML_DIR / "runs", "pretrain_camels_ealstm")
            if not base_run:
                print("ERROR: No pretrained model found. Either:")
                print("  1. Run pretraining first: python scripts/train_lstm.py pretrain")
                print("  2. Train from scratch: python scripts/train_lstm.py finetune --no-pretrain")
                sys.exit(1)
            print(f"Auto-detected pretrained run: {base_run}")
        else:
            base_run = Path(base_run)

        if not base_run.exists():
            print(f"ERROR: Base run not found: {base_run}")
            sys.exit(1)

        # Find the best pretrained checkpoint
        pretrain_weights = sorted(base_run.glob("model_epoch*.pt"))
        if not pretrain_weights:
            print(f"ERROR: No model checkpoints in {base_run}")
            sys.exit(1)
        pretrain_checkpoint = pretrain_weights[-1]  # latest epoch
        print(f"Pretrained weights: {pretrain_checkpoint}")

        # Remove finetune-specific keys — we'll do a fresh start_run
        # and manually load compatible LSTM weights
        cfg.pop("base_run_dir", None)
        cfg.pop("finetune_modules", None)

        tmp_config = ML_DIR / "configs" / "_finetune_tmp.yml"
        with open(tmp_config, "w") as f:
            yaml.dump(cfg, f)

        print(f"Fine-tuning EA-LSTM on Dagestan stations")
        print(f"Base run: {base_run}")
        print(f"Config: {tmp_config}")
        print(f"Device: {cfg.get('device', 'cpu')}")
        print("Loading pretrained LSTM core weights (input/output layers retrained)")
        print("=" * 60)

        # Use a custom training hook to load pretrained weights
        _finetune_with_pretrained_weights(tmp_config, pretrain_checkpoint, cfg.get("device", "cpu"))
        tmp_config.unlink(missing_ok=True)

    # Find the run that was just created
    run = find_latest_run(ML_DIR / "runs", "finetune_dagestan" if not args.no_pretrain else "dagestan_ealstm_scratch")
    if run:
        print(f"\nFine-tuning complete! Run directory: {run}")
        print(f"\nNext step:")
        print(f"  python scripts/train_lstm.py evaluate --run-dir {run}")


def evaluate(args):
    """Evaluate a trained model and export results."""
    from neuralhydrology.nh_run import eval_run

    run_dir = Path(args.run_dir)
    if not run_dir.exists():
        print(f"ERROR: Run directory not found: {run_dir}")
        sys.exit(1)

    period = args.period
    print("=" * 60)
    print(f"Evaluating model: {run_dir.name}")
    print(f"Period: {period}")
    print("=" * 60)

    eval_run(run_dir=run_dir, period=period)

    # Load and display results
    results_file = run_dir / period / f"model_epoch{args.epoch:03d}" / f"{period}_metrics.json" if args.epoch else None
    # Try to find results automatically
    period_dir = run_dir / period
    if period_dir.exists():
        metric_files = list(period_dir.rglob("*_metrics.json"))
        if metric_files:
            results_file = metric_files[0]

    if results_file and results_file.exists():
        with open(results_file) as f:
            metrics = json.load(f)
        print(f"\n{'='*60}")
        print(f"Results ({period}):")
        print(f"{'='*60}")
        for basin, basin_metrics in metrics.items():
            print(f"\n  {basin}:")
            for metric, value in basin_metrics.items():
                if isinstance(value, float):
                    print(f"    {metric}: {value:.4f}")

    # Export for comparison with XGBoost
    export_comparison(run_dir, period)


def export_comparison(run_dir: Path, period: str):
    """Export LSTM results alongside XGBoost for comparison."""
    # Load XGBoost results
    xgb_results_path = ML_DIR / "models" / "evaluation_results.json"
    if not xgb_results_path.exists():
        print("\nNo XGBoost results found for comparison.")
        return

    with open(xgb_results_path) as f:
        xgb_results = json.load(f)

    # Load LSTM results
    period_dir = run_dir / period
    if not period_dir.exists():
        return

    metric_files = list(period_dir.rglob("*_metrics.json"))
    if not metric_files:
        return

    with open(metric_files[0]) as f:
        lstm_metrics = json.load(f)

    # Print comparison table
    print(f"\n{'='*70}")
    print(f"XGBoost vs EA-LSTM Comparison ({period})")
    print(f"{'='*70}")
    print(f"{'Station':<22} {'XGB NSE t1':>10} {'LSTM NSE':>10} {'XGB NSE t7':>10}")
    print("-" * 70)

    for xgb in xgb_results:
        basin = xgb["basin_id"]
        xgb_nse_t1 = xgb["horizons"].get("t1", {}).get("nse", "N/A")
        xgb_nse_t7 = xgb["horizons"].get("t7", {}).get("nse", "N/A")
        lstm_nse = lstm_metrics.get(basin, {}).get("NSE", "N/A")

        if isinstance(xgb_nse_t1, float):
            xgb_nse_t1 = f"{xgb_nse_t1:.4f}"
        if isinstance(xgb_nse_t7, float):
            xgb_nse_t7 = f"{xgb_nse_t7:.4f}"
        if isinstance(lstm_nse, float):
            lstm_nse = f"{lstm_nse:.4f}"

        print(f"  {basin:<20} {xgb_nse_t1:>10} {lstm_nse:>10} {xgb_nse_t7:>10}")


def export_model(args):
    """Export trained LSTM weights for inference service."""
    run_dir = Path(args.run_dir)
    if not run_dir.exists():
        print(f"ERROR: Run not found: {run_dir}")
        sys.exit(1)

    out_dir = ML_DIR / "models" / "lstm"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Find the best model checkpoint
    checkpoints = list(run_dir.glob("model_epoch*.pt"))
    if not checkpoints:
        print(f"ERROR: No checkpoints found in {run_dir}")
        sys.exit(1)

    # Use the last checkpoint (or best if available)
    best = sorted(checkpoints)[-1]
    dest = out_dir / "model.pt"
    shutil.copy2(best, dest)
    print(f"Exported: {best.name} -> {dest}")

    # Copy config
    cfg_src = run_dir / "config.yml"
    if cfg_src.exists():
        shutil.copy2(cfg_src, out_dir / "config.yml")
        print(f"Exported: config.yml -> {out_dir / 'config.yml'}")

    # Copy scaler
    for scaler_file in run_dir.glob("*scaler*"):
        shutil.copy2(scaler_file, out_dir / scaler_file.name)
        print(f"Exported: {scaler_file.name} -> {out_dir / scaler_file.name}")

    print(f"\nModel exported to {out_dir}")
    print("Ready for inference integration (Step 3.5)")


def main():
    parser = argparse.ArgumentParser(description="Самур AI — EA-LSTM Training Pipeline")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Pretrain
    sub_pre = subparsers.add_parser("pretrain", help="Pretrain on CAMELS-US")
    sub_pre.add_argument("--device", type=str, default=None,
                         help="Override device (cpu, mps, cuda:0)")

    # Fine-tune
    sub_ft = subparsers.add_parser("finetune", help="Fine-tune on Dagestan stations")
    sub_ft.add_argument("--device", type=str, default=None,
                        help="Override device (cpu, mps, cuda:0)")
    sub_ft.add_argument("--base-run", type=str, default=None,
                        help="Path to pretrained run directory")
    sub_ft.add_argument("--no-pretrain", action="store_true",
                        help="Train from scratch without pretraining")

    # Evaluate
    sub_ev = subparsers.add_parser("evaluate", help="Evaluate trained model")
    sub_ev.add_argument("--device", type=str, default=None,
                        help="Override device (cpu, mps, cuda:0)")
    sub_ev.add_argument("--run-dir", type=str, required=True,
                        help="Path to the run directory")
    sub_ev.add_argument("--period", type=str, default="test",
                        choices=["train", "validation", "test"])
    sub_ev.add_argument("--epoch", type=int, default=None,
                        help="Specific epoch to evaluate (default: best)")

    # Export
    sub_ex = subparsers.add_parser("export", help="Export model for inference")
    sub_ex.add_argument("--run-dir", type=str, required=True,
                        help="Path to the run directory")

    args = parser.parse_args()

    # Ensure we're in the ML directory
    import os
    os.chdir(ML_DIR)
    print(f"Working directory: {ML_DIR}")

    if args.command == "pretrain":
        pretrain(args)
    elif args.command == "finetune":
        finetune(args)
    elif args.command == "evaluate":
        evaluate(args)
    elif args.command == "export":
        export_model(args)


if __name__ == "__main__":
    main()
