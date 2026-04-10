// SPDX-License-Identifier: AGPL-3.0-only
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
}

export function MapLegends({
  layers,
  hasRiverLevels,
  hasPrecipitation,
  hasSoilMoisture,
  hasSnowData,
  hasRunoffData,
  hasEarthquakes,
}: MapLegendsProps) {
  const showAny =
    (layers.floodHeatmap && hasRiverLevels) ||
    (layers.precipitation && hasPrecipitation) ||
    (layers.soilMoisture && hasSoilMoisture) ||
    (layers.snow && hasSnowData) ||
    (layers.runoff && hasRunoffData) ||
    (layers.earthquakes && hasEarthquakes);

  if (!showAny) return null;

  return (
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
          <div className="eq-legend-title">Землетрясения</div>
          <div className="eq-legend-items">
            <span className="eq-legend-dot eq-legend-dot--sm" /> M3.5
            <span className="eq-legend-dot eq-legend-dot--md" /> M4.5
            <span className="eq-legend-dot eq-legend-dot--lg" /> M5.5+
          </div>
        </div>
      )}
    </div>
  );
}
