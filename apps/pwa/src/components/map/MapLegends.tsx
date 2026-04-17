// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";
import { legendGradientCSS } from "./SoilMoistureOverlay.js";
import { snowLegendGradientCSS } from "./SnowOverlay.js";
import { runoffLegendGradientCSS } from "./RunoffOverlay.js";
import { precipLegendGradientCSS } from "./PrecipitationOverlay.js";
import { floodLegendGradientCSS } from "./FloodZoneOverlay.js";

interface LayerFlags {
  floodHeatmap: boolean;
  precipitation: boolean;
  soilMoisture: boolean;
  snow: boolean;
  runoff: boolean;
  earthquakes: boolean;
}

interface MapLegendsProps {
  layers: LayerFlags;
  hasRiverLevels: boolean;
  hasPrecipitation: boolean;
  hasSoilMoisture: boolean;
  hasSnowData: boolean;
  hasRunoffData: boolean;
  hasEarthquakes: boolean;
  hasAiForecasts: boolean;
}

const STORAGE_KEY = "kunak.mapLegends.open";

export function MapLegends({
  layers,
  hasRiverLevels,
  hasPrecipitation,
  hasSoilMoisture,
  hasSnowData,
  hasRunoffData,
  hasEarthquakes,
  hasAiForecasts,
}: MapLegendsProps) {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "true"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, open ? "true" : "false"); } catch { /* ignore */ }
  }, [open]);

  const showAny =
    (layers.floodHeatmap && hasRiverLevels) ||
    (layers.precipitation && hasPrecipitation) ||
    (layers.soilMoisture && hasSoilMoisture) ||
    (layers.snow && hasSnowData) ||
    (layers.runoff && hasRunoffData) ||
    (layers.earthquakes && hasEarthquakes);

  if (!showAny) return null;

  return (
    <>
      <button
        type="button"
        className={`map-legends-toggle${open ? " map-legends-toggle--open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Скрыть легенду" : "Показать легенду"}
        aria-expanded={open}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="5" cy="6" r="1.5" fill="currentColor" stroke="none" />
          <line x1="10" y1="6" x2="20" y2="6" />
          <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <line x1="10" y1="12" x2="20" y2="12" />
          <circle cx="5" cy="18" r="1.5" fill="currentColor" stroke="none" />
          <line x1="10" y1="18" x2="20" y2="18" />
        </svg>
      </button>

      {open && (
        <div className="map-legends">
      {layers.floodHeatmap && hasRiverLevels && (
        <div className="flood-legend">
          <div className="flood-legend-title">🌊 Зона затопления</div>
          <div className="flood-legend-scale">
            <div className="flood-legend-bar" style={{ background: floodLegendGradientCSS() }} />
            <div className="flood-legend-ends">
              <span>повышен</span>
              <span>опасный</span>
            </div>
          </div>
          {hasAiForecasts && (
            <div className="ai-legend-inline">
              <span className="ai-legend-ring" />
              <span className="ai-legend-text">Кунак AI</span>
            </div>
          )}
        </div>
      )}

      {layers.precipitation && hasPrecipitation && (
        <div className="precip-legend">
          <div className="precip-legend-header">
            <span className="precip-legend-icon">🌧</span>
            <span className="precip-legend-title">Осадки (24ч)</span>
          </div>
          <div className="precip-legend-bar" style={{ background: precipLegendGradientCSS() }} />
          <div className="precip-legend-ticks">
            <div className="precip-legend-tick"><span className="precip-legend-tick-val">1</span></div>
            <div className="precip-legend-tick"><span className="precip-legend-tick-val">5</span></div>
            <div className="precip-legend-tick"><span className="precip-legend-tick-val">15</span></div>
            <div className="precip-legend-tick"><span className="precip-legend-tick-val">30</span></div>
            <div className="precip-legend-tick"><span className="precip-legend-tick-val">60+</span></div>
          </div>
          <div className="precip-legend-unit">мм</div>
        </div>
      )}

      {layers.soilMoisture && hasSoilMoisture && (
        <div className="soil-legend">
          <div className="soil-legend-header">
            <span className="soil-legend-icon">💧</span>
            <span className="soil-legend-title">Влажность почвы</span>
          </div>
          <div className="soil-legend-bar" style={{ background: legendGradientCSS() }} />
          <div className="soil-legend-ticks">
            <div className="soil-legend-tick"><span className="soil-legend-tick-val">сухая</span></div>
            <div className="soil-legend-tick"><span className="soil-legend-tick-val">мокрая</span></div>
          </div>
        </div>
      )}

      {layers.snow && hasSnowData && (
        <div className="snow-legend">
          <div className="snow-legend-header">
            <span className="snow-legend-icon">🏔️</span>
            <span className="snow-legend-title">Таяние снега</span>
          </div>
          <div className="snow-legend-bar" style={{ background: snowLegendGradientCSS() }} />
          <div className="snow-legend-ticks">
            <div className="snow-legend-tick"><span className="snow-legend-tick-val">слабое</span></div>
            <div className="snow-legend-tick"><span className="snow-legend-tick-val">сильное</span></div>
          </div>
        </div>
      )}

      {layers.runoff && hasRunoffData && (
        <div className="runoff-legend">
          <div className="runoff-legend-title">⚠ Риск затопления</div>
          <div className="runoff-legend-scale">
            <div className="runoff-legend-bar" style={{ background: runoffLegendGradientCSS() }} />
            <div className="runoff-legend-ends">
              <span>низкий</span>
              <span>высокий</span>
            </div>
          </div>
        </div>
      )}

      {layers.earthquakes && hasEarthquakes && (
        <div className="eq-legend">
          <div className="eq-legend-title">Магнитуда</div>
          <div className="eq-legend-items">
            <span className="eq-legend-dot eq-legend-dot--sm" /> 3.5
            <span className="eq-legend-dot eq-legend-dot--md" /> 4.5
            <span className="eq-legend-dot eq-legend-dot--lg" /> 5.5+
          </div>
        </div>
      )}

        </div>
      )}
    </>
  );
}
