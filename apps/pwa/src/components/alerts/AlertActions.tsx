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

function extractStationName(alert: Alert): string | null {
  // AI-alert titles have "на станции X" — check there first since
  // the modern AI body no longer includes a "Станция:" header.
  const titleMatch = alert.title.match(/на станции\s+([^,\n]+?)\s*$/);
  if (titleMatch) return titleMatch[1].trim();
  // Legacy / river-alert pattern — "Станция: X" is in the body.
  const bodyMatch = alert.body.match(/Станция:\s*(.+?)(?:\n|$)/);
  return bodyMatch ? bodyMatch[1].trim() : null;
}

function isRiverOrAiAlert(alert: Alert): boolean {
  return alert.source === "river"
    || alert.source === "ai_forecast"
    || /Станция:/.test(alert.body)
    || /на станции/.test(alert.title);
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
    const station = extractStationName(alert);
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
