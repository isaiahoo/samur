// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Layer toggle — trigger button + geometric panel with inline color
 * legends for each active overlay. The legend used to live in a
 * separate floating panel; merging it here means one control, one
 * mental model, one tap to reach everything layer-related.
 */

interface LayerConfig {
  key: string;
  label: string;
  active: boolean;
  /** Inline color scale shown under the label when the layer is active. */
  legend?: {
    gradient: string;
    min: string;
    max: string;
  };
}

interface Props {
  layers: LayerConfig[];
  onToggle: (key: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function LayerToggle({ layers, onToggle, open, onOpenChange }: Props) {
  return (
    <div className="nerv-layers">
      <button
        className="nerv-layers-trigger"
        onClick={() => onOpenChange?.(!open)}
        aria-label="Слои карты"
        aria-expanded={open ?? false}
      >
        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      </button>
      {open && (
        <div className="nerv-layers-panel" role="region" aria-label="Слои карты">
          {layers.map((l) => (
            <div key={l.key} className="nerv-layer-row">
              <button
                className={`nerv-layer-item${l.active ? " nerv-layer-item--on" : ""}`}
                onClick={() => onToggle(l.key)}
                aria-pressed={l.active}
              >
                <span className="nerv-layer-indicator" />
                <span className="nerv-layer-label">{l.label}</span>
              </button>
              {l.active && l.legend && (
                <div className="nerv-layer-legend" aria-hidden="true">
                  <div
                    className="nerv-layer-legend-bar"
                    style={{ background: l.legend.gradient }}
                  />
                  <div className="nerv-layer-legend-ends">
                    <span>{l.legend.min}</span>
                    <span>{l.legend.max}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
