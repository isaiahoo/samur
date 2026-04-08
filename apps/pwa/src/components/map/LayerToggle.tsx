// SPDX-License-Identifier: AGPL-3.0-only
interface LayerConfig {
  key: string;
  label: string;
  active: boolean;
}

interface Props {
  layers: LayerConfig[];
  onToggle: (key: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LayerToggle({ layers, onToggle, open, onOpenChange }: Props) {
  return (
    <div className="layer-toggle">
      <button
        className="layer-toggle-btn"
        onClick={() => onOpenChange(!open)}
        aria-label="Слои карты"
      >
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      </button>
      {open && (
        <div className="layer-toggle-panel">
          {layers.map((l) => (
            <label key={l.key} className="layer-toggle-item">
              <input
                type="checkbox"
                checked={l.active}
                onChange={() => onToggle(l.key)}
              />
              <span>{l.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
