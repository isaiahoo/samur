# SPDX-License-Identifier: AGPL-3.0-only
from pydantic import BaseModel


class PredictRequest(BaseModel):
    station_id: str
    model: str = "xgboost"


class ForecastPoint(BaseModel):
    date: str
    level_cm: float
    lower_90: float | None = None
    upper_90: float | None = None


class PredictResponse(BaseModel):
    station_id: str
    model: str
    model_version: str | None = None
    generated_at: str
    forecasts: list[ForecastPoint]
    metrics: dict | None = None
    skill_tier: str | None = None
    inputs_source: str | None = None
    ood_warnings: list[dict] | None = None
