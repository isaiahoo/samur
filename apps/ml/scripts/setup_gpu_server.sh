#!/bin/bash
# Samur AI — GPU Server Setup Script
# SPDX-License-Identifier: AGPL-3.0-only
#
# Run this on a GPU machine to set up the training environment.
# Usage: bash setup_gpu_server.sh
#
# Prerequisites: Python 3.10+, NVIDIA GPU with CUDA drivers

set -e

echo "============================================================"
echo "Samur AI — GPU Training Environment Setup"
echo "============================================================"

# Check GPU
echo ""
echo "1. Checking GPU..."
if command -v nvidia-smi &> /dev/null; then
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
else
    echo "WARNING: nvidia-smi not found. CUDA may not be available."
fi

# Check Python
echo ""
echo "2. Checking Python..."
python3 --version

# Create venv
echo ""
echo "3. Creating virtual environment..."
cd "$(dirname "$0")/.."
python3 -m venv .venv
source .venv/bin/activate

# Install PyTorch with CUDA
echo ""
echo "4. Installing PyTorch (CUDA)..."
pip install --upgrade pip
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121

# Install NeuralHydrology + deps
echo ""
echo "5. Installing NeuralHydrology + dependencies..."
pip install neuralhydrology xarray netCDF4 h5py pandas numpy scikit-learn matplotlib xgboost httpx

# Verify
echo ""
echo "6. Verifying installation..."
python3 -c "
import torch
print(f'PyTorch {torch.__version__}')
print(f'CUDA available: {torch.cuda.is_available()}')
if torch.cuda.is_available():
    print(f'GPU: {torch.cuda.get_device_name(0)}')
    print(f'VRAM: {torch.cuda.get_device_properties(0).total_mem / 1024**3:.1f} GB')
from neuralhydrology.modelzoo.ealstm import EALSTM
from neuralhydrology.nh_run import start_run
print('NeuralHydrology OK')
"

echo ""
echo "============================================================"
echo "Setup complete! Next steps:"
echo "  1. Download CAMELS-US: python scripts/download_camels.py"
echo "  2. Pretrain: python scripts/train_lstm.py pretrain --device cuda:0"
echo "  3. Fine-tune: python scripts/train_lstm.py finetune --device cuda:0"
echo "============================================================"
