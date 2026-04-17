# SPDX-License-Identifier: AGPL-3.0-only
"""
Самур AI — Flood Prediction Service
FastAPI microservice serving XGBoost water level forecasts.
"""

import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException

from .schemas import PredictRequest, PredictResponse, ForecastPoint
from .predict import Predictor, MODEL_VERSION

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
        "model_version": MODEL_VERSION,
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
        model_version=MODEL_VERSION,
        generated_at=datetime.now(timezone.utc).isoformat(),
        forecasts=forecasts,
        metrics=station_metrics,
        skill_tier=predictor.skill_tier(req.station_id),
        inputs_source=predictor.last_inputs_source(req.station_id),
        ood_warnings=predictor.last_ood(req.station_id),
    )


@app.api_route("/predict/all", methods=["GET", "POST"])
async def predict_all():
    if not predictor:
        raise HTTPException(503, "Models not loaded")

    # Reset Express API reachability flag for this cycle
    predictor._express_reachable = True

    station_ids = predictor.loaded_stations()

    def run_one(sid: str) -> dict:
        try:
            forecasts = predictor.predict(sid)
            return {
                "station_id": sid,
                "forecasts": [f.model_dump() for f in forecasts],
                "skill_tier": predictor.skill_tier(sid),
                "best_nse": predictor.best_nse(sid),
                "inputs_source": predictor.last_inputs_source(sid),
                "ood_warnings": predictor.last_ood(sid),
            }
        except Exception as e:
            logger.warning("Prediction failed for %s: %s", sid, e)
            return {"station_id": sid, "error": str(e)}

    # Run per-station predictions in parallel. XGBoost inference and pandas
    # feature building are sync-but-fast; the slow part is HTTP fetches for
    # weather + water levels. A small thread pool lets those overlap.
    loop = asyncio.get_running_loop()
    with ThreadPoolExecutor(max_workers=min(6, len(station_ids) or 1)) as ex:
        results = await asyncio.gather(
            *[loop.run_in_executor(ex, run_one, sid) for sid in station_ids]
        )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_version": MODEL_VERSION,
        "data": list(results),
    }


@app.get("/skill")
async def skill():
    """Per-station model skill classification — MODEL QUALITY ONLY.

    Uses the hold-out NSE from training, NOT input-data quality. Surfaced
    on admin dashboards to track model drift. The user-facing skill tier
    is returned inline from /predict and cascades input-data quality on
    top — see Predictor.skill_tier vs model_skill_tier."""
    if not predictor:
        raise HTTPException(503, "Models not loaded")
    return {
        "data": {
            sid: {
                "best_nse": predictor.best_nse(sid),
                "tier": predictor.model_skill_tier(sid),
            }
            for sid in predictor.loaded_stations()
        }
    }
