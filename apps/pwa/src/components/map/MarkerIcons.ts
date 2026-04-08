// SPDX-License-Identifier: AGPL-3.0-only
// Color constants for data-driven MapLibre styling.
// These are used in match expressions on layer paint properties.

import { SEVERITY_COLORS } from "@samur/shared";

export const INCIDENT_COLORS: Record<string, string> = {
  critical: SEVERITY_COLORS.critical, // #EF4444
  high: SEVERITY_COLORS.high,         // #F97316
  medium: SEVERITY_COLORS.medium,     // #F59E0B
  low: SEVERITY_COLORS.low,           // #3B82F6
};

export const HELP_COLORS = {
  need: "#EF4444",
  offer: "#22C55E",
} as const;

export const SHELTER_COLORS = {
  open: "#22C55E",
  full: "#6B7280",
  closed: "#9CA3AF",
} as const;
