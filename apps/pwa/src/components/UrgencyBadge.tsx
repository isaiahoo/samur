// SPDX-License-Identifier: AGPL-3.0-only
import {
  SEVERITY_LABELS,
  URGENCY_LABELS,
  ALERT_URGENCY_LABELS,
  SEVERITY_COLORS,
  URGENCY_COLORS,
  ALERT_URGENCY_COLORS,
} from "@samur/shared";

interface Props {
  value: string;
  kind?: "severity" | "urgency" | "alert";
}

export function UrgencyBadge({ value, kind = "severity" }: Props) {
  const labels = kind === "alert" ? ALERT_URGENCY_LABELS : kind === "urgency" ? URGENCY_LABELS : SEVERITY_LABELS;
  const colors = kind === "alert" ? ALERT_URGENCY_COLORS : kind === "urgency" ? URGENCY_COLORS : SEVERITY_COLORS;

  return (
    <span
      className="urgency-badge"
      style={{ backgroundColor: colors[value] ?? "#71717a" }}
    >
      {labels[value] ?? value}
    </span>
  );
}
