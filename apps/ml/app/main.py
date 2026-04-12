# SPDX-License-Identifier: AGPL-3.0-only
"""
Самур AI — Flood Prediction Service
FastAPI microservice serving XGBoost water level forecasts.
"""

import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException

from .schemas import PredictRequest, PredictResponse, ForecastPoint
from .predict import Predictor

logger = logging.getLogger("samur-ai")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")

MODEL_DIR = Path(__file__).parent.parent / "models"
DATA_DIR = Path(__file__).parent.parent / "data"

predictor: Predictor | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global predictor
    logger.info("Loading models from %s", MODEL_DIR)
    predictor = Predictor(MODEL_DIR, DATA_DIR)
    loaded = predictor.loaded_stations()
    logger.info("Loaded models for %d stations: %s", len(loaded), loaded)

    metrics_path = MODEL_DIR / "evaluation_results.json"
    if metrics_path.exists():
        with open(metrics_path) as f:
            app.state.metrics = json.load(f)
    else:
        app.state.metrics = []

    yield
    logger.info("Shutting down")


app = FastAPI(title="Самур AI", version="1.0.0", lifespan=lifespan)


@app.get("/health")
async def health():
    stations = predictor.loaded_stations() if predictor else []
    return {
        "status": "ok" if predictor and len(stations) > 0 else "degraded",
        "loaded_stations": stations,
        "model": "xgboost",
    }


@app.get("/metrics")
async def metrics():
    return {"data": app.state.metrics}


@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest):
    if not predictor:
        raise HTTPException(503, "Models not loaded")

    if req.model != "xgboost":
        raise HTTPException(400, f"Unknown model: {req.model}. Available: xgboost")

    try:
        forecasts = predictor.predict(req.station_id)
    except KeyError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        logger.exception("Prediction failed for %s", req.station_id)
        raise HTTPException(500, f"Prediction failed: {e}")

    station_metrics = None
    for m in app.state.metrics:
        if m["basin_id"] == req.station_id:
            station_metrics = m.get("horizons", {})
            break

    return PredictResponse(
        station_id=req.station_id,
        model=req.model,
        generated_at=datetime.utcnow().isoformat() + "Z",
        forecasts=forecasts,
        metrics=station_metrics,
    )


@app.api_route("/predict/all", methods=["GET", "POST"])
async def predict_all():
    if not predictor:
        raise HTTPException(503, "Models not loaded")

    results = []
    for station_id in predictor.loaded_stations():
        try:
            forecasts = predictor.predict(station_id)
            results.append({
                "station_id": station_id,
                "forecasts": [f.model_dump() for f in forecasts],
            })
        except Exception as e:
            logger.warning("Prediction failed for %s: %s", station_id, e)
            results.append({"station_id": station_id, "error": str(e)})

    return {"generated_at": datetime.utcnow().isoformat() + "Z", "data": results}
