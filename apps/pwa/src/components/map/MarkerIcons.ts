// SPDX-License-Identifier: AGPL-3.0-only
import L from "leaflet";

function svgIcon(color: string, symbol: string): L.DivIcon {
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="background:${color};width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3)">${symbol}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16],
  });
}

export const incidentIcons: Record<string, L.DivIcon> = {
  critical: svgIcon("#EF4444", "!"),
  high: svgIcon("#F97316", "!"),
  medium: svgIcon("#F59E0B", "!"),
  low: svgIcon("#3B82F6", "i"),
};

export const helpNeedIcon = svgIcon("#EF4444", "?");
export const helpOfferIcon = svgIcon("#22C55E", "+");

export const shelterOpenIcon = svgIcon("#22C55E", "H");
export const shelterFullIcon = svgIcon("#6B7280", "H");
export const shelterClosedIcon = svgIcon("#9CA3AF", "H");

export function getShelterIcon(status: string): L.DivIcon {
  if (status === "open") return shelterOpenIcon;
  if (status === "full") return shelterFullIcon;
  return shelterClosedIcon;
}

export function getRiverIcon(levelCm: number, dangerLevelCm: number): L.DivIcon {
  const ratio = levelCm / dangerLevelCm;
  const color = ratio >= 1 ? "#EF4444" : ratio >= 0.8 ? "#F97316" : ratio >= 0.6 ? "#F59E0B" : "#3B82F6";
  return svgIcon(color, "~");
}

export const pendingIcon = svgIcon("#9CA3AF", "⏳");
