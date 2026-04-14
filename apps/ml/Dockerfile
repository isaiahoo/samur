# SPDX-License-Identifier: AGPL-3.0-only
# Самур AI — Flood Prediction Service
FROM python:3.11-slim

WORKDIR /app

# Install system deps (for xgboost libgomp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ ./app/
COPY models/ ./models/
COPY data/time_series/ ./data/time_series/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info"]
