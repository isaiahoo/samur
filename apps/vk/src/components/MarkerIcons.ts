// SPDX-License-Identifier: AGPL-3.0-only
import L from "leaflet";
import { SEVERITY_COLORS, URGENCY_COLORS } from "@samur/shared";

function circleIcon(color: string, symbol: string): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff">${symbol}</div>`,
  });
}

export const incidentIcons: Record<string, L.DivIcon> = {
  low: circleIcon(SEVERITY_COLORS.low, "!"),
  medium: circleIcon(SEVERITY_COLORS.medium, "!"),
  high: circleIcon(SEVERITY_COLORS.high, "!!"),
  critical: circleIcon(SEVERITY_COLORS.critical, "‼"),
};

export const helpNeedIcon = circleIcon(URGENCY_COLORS.urgent, "🤝");
export const helpOfferIcon = circleIcon("#22C55E", "✋");

export const shelterOpenIcon = circleIcon("#22C55E", "🏠");
export const shelterFullIcon = circleIcon(SEVERITY_COLORS.medium, "🏠");
