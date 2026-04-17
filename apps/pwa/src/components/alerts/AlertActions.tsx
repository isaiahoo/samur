// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Deep-link row rendered under an alert card. Infers the relevant
 * target from the alert's body text — river-threshold and AI alerts
 * have a "Станция: {name}" line; earthquake alerts include place +
 * magnitude; manual alerts get no actions (coordinator didn't attach
 * one). Better than nothing until we add a structured metadata field
 * to the Alert model.
 */

import { useNavigate } from "react-router-dom";
import type { Alert } from "@samur/shared";

function extractStationName(body: string): string | null {
  const m = body.match(/Станция:\s*(.+?)(?:\n|$)/);
  return m ? m[1].trim() : null;
}

function isRiverOrAiAlert(alert: Alert): boolean {
  return /Станция:/.test(alert.body);
}

function isEarthquakeAlert(alert: Alert): boolean {
  return /Магнитуда:/.test(alert.body) || /Землетрясение/.test(alert.title);
}

interface Props {
  alert: Alert;
}

export function AlertActions({ alert }: Props) {
  const navigate = useNavigate();
  const actions: Array<{ label: string; onTap: () => void }> = [];

  if (isRiverOrAiAlert(alert)) {
    const station = extractStationName(alert.body);
    if (station) {
      actions.push({
        label: `Показать ${station} на карте`,
        onTap: () => navigate(`/?station=${encodeURIComponent(station)}`),
      });
    }
  }

  if (isEarthquakeAlert(alert)) {
    actions.push({
      label: "Показать на карте",
      onTap: () => navigate("/"),
    });
  }

  // Universal: when any urgency is critical, offer the shelters shortcut.
  if (alert.urgency === "critical") {
    actions.push({
      label: "Найти убежище",
      onTap: () => navigate("/?layer=shelters"),
    });
  }

  if (actions.length === 0) return null;

  return (
    <div className="alert-actions">
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          className="alert-action-btn"
          onClick={a.onTap}
        >
          {a.label}
          <span className="alert-action-arrow" aria-hidden="true">→</span>
        </button>
      ))}
    </div>
  );
}
