// SPDX-License-Identifier: AGPL-3.0-only

/**
 * NERV-style layer toggle — compact trigger button that opens a
 * geometric panel on tap. Tap again (or outside) to dismiss.
 */

interface LayerConfig {
  key: string;
  label: string;
  active: boolean;
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
      >
        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      </button>
      {open && (
        <div className="nerv-layers-panel">
          {layers.map((l) => (
            <button
              key={l.key}
              className={`nerv-layer-item${l.active ? " nerv-layer-item--on" : ""}`}
              onClick={() => onToggle(l.key)}
            >
              <span className="nerv-layer-indicator" />
              <span className="nerv-layer-label">{l.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
