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
    case "childcare":
      // Parent holding child's hand — two heads + arc.
      return (
        <svg {...common}>
          <circle cx="8" cy="7" r="2.5" />
          <circle cx="16" cy="9" r="1.8" />
          <path d="M8 10v5l-2 6M16 11v4l2 6" />
          <path d="M8 15h8" />
        </svg>
      );
    case "petcare":
      // Paw print.
      return (
        <svg {...common}>
          <circle cx="6" cy="11" r="1.8" />
          <circle cx="10" cy="7" r="1.8" />
          <circle cx="14" cy="7" r="1.8" />
          <circle cx="18" cy="11" r="1.8" />
          <path d="M8 17c0-2.5 1.8-4 4-4s4 1.5 4 4c0 2-1.5 3-4 3s-4-1-4-3z" />
        </svg>
      );
    case "tutoring":
      // Open book with bookmark.
      return (
        <svg {...common}>
          <path d="M4 5a2 2 0 012-2h5v16H6a2 2 0 00-2 2V5z" />
          <path d="M20 5a2 2 0 00-2-2h-5v16h5a2 2 0 012 2V5z" />
        </svg>
      );
    case "errands":
      // Shopping bag with check.
      return (
        <svg {...common}>
          <path d="M5 8h14l-1 12a2 2 0 01-2 2H8a2 2 0 01-2-2L5 8z" />
          <path d="M9 8V6a3 3 0 016 0v2" />
          <path d="M9 14l2 2 4-4" />
        </svg>
      );
    case "repair":
      // Wrench + screwdriver crossed.
      return (
        <svg {...common}>
          <path d="M14 4a4 4 0 014 4 4 4 0 01-4.5 4L5 20l-2-2 8-8.5A4 4 0 0114 4z" />
          <path d="M20 14l-6 6" />
        </svg>
      );
    case "giveaway":
      // Gift / shared parcel.
      return (
        <svg {...common}>
          <path d="M4 11h16v9a1 1 0 01-1 1H5a1 1 0 01-1-1v-9z" />
          <path d="M2 7h20v4H2z" />
          <path d="M12 21V7" />
          <path d="M12 7s-2-4-4-4a2 2 0 000 4h4zM12 7s2-4 4-4a2 2 0 010 4h-4z" />
        </svg>
      );
    case "other":
    default:
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M8 10h8M8 14h5" />
        </svg>
      );
  }
}
