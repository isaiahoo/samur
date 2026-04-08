// SPDX-License-Identifier: AGPL-3.0-only
// Color constants for MapLibre data-driven styling in VK Mini App
import { SEVERITY_COLORS } from "@samur/shared";

export const INCIDENT_COLORS: Record<string, string> = {
  low: SEVERITY_COLORS.low,
  medium: SEVERITY_COLORS.medium,
  high: SEVERITY_COLORS.high,
  critical: SEVERITY_COLORS.critical,
};

export const HELP_COLORS = {
  need: "#EF4444",
  offer: "#22C55E",
} as const;

export const SHELTER_COLORS = {
  open: "#22C55E",
  full: "#6B7280",
} as const;
