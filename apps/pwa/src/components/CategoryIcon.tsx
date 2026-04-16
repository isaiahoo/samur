// SPDX-License-Identifier: AGPL-3.0-only
import type { SVGProps } from "react";

type Props = { category: string; size?: number } & SVGProps<SVGSVGElement>;

export function CategoryIcon({ category, size = 20, ...rest }: Props) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...rest,
  };

  switch (category) {
    case "rescue":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="4" />
          <path d="M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
        </svg>
      );
    case "shelter":
      return (
        <svg {...common}>
          <path d="M3 11.5L12 4l9 7.5" />
          <path d="M5 10v10h14V10" />
          <path d="M10 20v-6h4v6" />
        </svg>
      );
    case "food":
      return (
        <svg {...common}>
          <path d="M4 4v7a3 3 0 003 3v6" />
          <path d="M7 4v7" />
          <path d="M10 4v7" />
          <path d="M17 4c-1.5 0-3 1.5-3 4s1.5 4 3 4v8" />
        </svg>
      );
    case "water":
      return (
        <svg {...common}>
          <path d="M12 3s-6 7-6 11a6 6 0 0012 0c0-4-6-11-6-11z" />
        </svg>
      );
    case "medicine":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      );
    case "equipment":
      return (
        <svg {...common}>
          <path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.8 2.8-2.5-2.5 2.3-3.3z" />
        </svg>
      );
    case "transport":
      return (
        <svg {...common}>
          <path d="M3 17V7a1 1 0 011-1h10v11" />
          <path d="M14 10h4l3 4v3h-2" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="17" cy="18" r="2" />
        </svg>
      );
    case "labor":
      return (
        <svg {...common}>
          <circle cx="9" cy="7" r="3" />
          <path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" />
          <circle cx="17" cy="8" r="2.5" />
          <path d="M21 21v-1.5a3.5 3.5 0 00-3.5-3.5H16" />
        </svg>
      );
    case "generator":
      return (
        <svg {...common}>
          <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
        </svg>
      );
    case "pump":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4v4M12 16v4M4 12h4M16 12h4" />
          <path d="M12 9a3 3 0 100 6 3 3 0 000-6z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M8 10h8M8 14h5" />
        </svg>
      );
  }
}
