// SPDX-License-Identifier: AGPL-3.0-only

/**
 * NERV-style layer toggle — vertical strip of geometric icon buttons.
 * Each button toggles a map layer. Active state glows cyan (or red in crisis mode).
 */

interface LayerConfig {
  key: string;
  label: string;
  active: boolean;
}

interface Props {
  layers: LayerConfig[];
  onToggle: (key: string) => void;
}

export function LayerToggle({ layers, onToggle }: Props) {
  return (
    <div className="nerv-layers">
      {layers.map((l) => (
        <button
          key={l.key}
          className={`nerv-layer-btn${l.active ? " nerv-layer-btn--on" : ""}`}
          onClick={() => onToggle(l.key)}
          aria-label={l.label}
          title={l.label}
        >
          <LayerIcon type={l.key} />
        </button>
      ))}
    </div>
  );
}

function LayerIcon({ type }: { type: string }) {
  const size = 16;
  const common = {
    width: size,
    height: size,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    viewBox: "0 0 24 24",
  };

  switch (type) {
    case "incidents":
      // Warning triangle
      return (
        <svg {...common}>
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case "helpRequests":
      // Heart
      return (
        <svg {...common}>
          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
        </svg>
      );
    case "shelters":
      // House
      return (
        <svg {...common}>
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      );
    case "riverLevels":
      // Water wave
      return (
        <svg {...common}>
          <path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
          <path d="M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
        </svg>
      );
    case "floodHeatmap":
      // Heat / flame
      return (
        <svg {...common}>
          <path d="M12 2c0 4-4 6-4 10a4 4 0 008 0c0-4-4-6-4-10z" />
        </svg>
      );
    case "precipitation":
      // Rain drops
      return (
        <svg {...common}>
          <path d="M12 2v6M8 4v4M16 4v4" />
          <path d="M4 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
          <path d="M4 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
        </svg>
      );
    default:
      // Generic layers icon
      return (
        <svg {...common}>
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      );
  }
}
