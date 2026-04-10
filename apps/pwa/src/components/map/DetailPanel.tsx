// SPDX-License-Identifier: AGPL-3.0-only
import type { Incident, HelpRequest, Shelter, RiverLevel, EarthquakeEvent } from "@samur/shared";
import {
  INCIDENT_TYPE_LABELS,
  SEVERITY_LABELS,
  HELP_CATEGORY_LABELS,
  SHELTER_STATUS_LABELS,
  AMENITY_LABELS,
  formatRelativeTime,
} from "@samur/shared";
import { UrgencyBadge } from "../UrgencyBadge.js";
import { RiverLevelDetail } from "./RiverLevelDetail.js";
import type { SoilMoisturePoint } from "./geoJsonHelpers.js";

interface DetailPanelProps {
  type: string;
  data: unknown;
  allRiverLevels?: RiverLevel[];
  soilMoisture?: SoilMoisturePoint[];
  onClose: () => void;
}

export function DetailPanel({ type, data, allRiverLevels, soilMoisture }: DetailPanelProps) {
  if (type === "incident") {
    const inc = data as Incident;
    return (
      <div className="detail-panel">
        <div className="detail-header">
          <h3>{INCIDENT_TYPE_LABELS[inc.type] ?? inc.type}</h3>
          <UrgencyBadge value={inc.severity} kind="severity" />
        </div>
        <p className="detail-meta">{formatRelativeTime(inc.createdAt)}</p>
        {inc.address && <p>{inc.address}</p>}
        {inc.description && <p>{inc.description}</p>}
        <p className="text-muted">Статус: {SEVERITY_LABELS[inc.status] ?? inc.status}</p>
      </div>
    );
  }

  if (type === "helpRequest") {
    const hr = data as HelpRequest;
    return (
      <div className="detail-panel">
        <div className="detail-header">
          <h3>{HELP_CATEGORY_LABELS[hr.category] ?? hr.category}</h3>
          <UrgencyBadge value={hr.urgency} kind="urgency" />
        </div>
        <p className="detail-meta">
          {hr.type === "offer" ? "Предлагает помощь" : "Нужна помощь"} · {formatRelativeTime(hr.createdAt)}
        </p>
        {hr.address && <p>{hr.address}</p>}
        {hr.description && <p>{hr.description}</p>}
        {hr.contactName && <p>Контакт: {hr.contactName}</p>}
        {hr.contactPhone && (
          <a href={`tel:${hr.contactPhone}`} className="btn btn-primary" style={{ marginTop: 8 }}>
            Позвонить: {hr.contactPhone}
          </a>
        )}
      </div>
    );
  }

  if (type === "shelter") {
    const s = data as Shelter;
    const navUrl = `https://yandex.ru/maps/?rtext=~${s.lat},${s.lng}&rtt=auto`;
    return (
      <div className="detail-panel">
        <div className="detail-header">
          <h3>{s.name}</h3>
          <span className={`status-badge status-badge--${s.status}`}>
            {SHELTER_STATUS_LABELS[s.status]}
          </span>
        </div>
        <p>{s.address}</p>
        <p>Заполненность: {s.currentOccupancy} / {s.capacity}</p>
        {s.amenities.length > 0 && (
          <p>Удобства: {s.amenities.map((a) => AMENITY_LABELS[a] ?? a).join(", ")}</p>
        )}
        {s.contactPhone && (
          <a href={`tel:${s.contactPhone}`} className="btn btn-secondary" style={{ marginTop: 8 }}>
            {s.contactPhone}
          </a>
        )}
        <a href={navUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ marginTop: 8 }}>
          Построить маршрут
        </a>
      </div>
    );
  }

  if (type === "riverLevel") {
    return <RiverLevelDetail data={data as RiverLevel} allLevels={allRiverLevels ?? []} soilMoisture={soilMoisture ?? []} />;
  }

  if (type === "earthquake") {
    const eq = data as EarthquakeEvent;
    const depthLabel = eq.depth < 20 ? "мелкое" : eq.depth < 70 ? "среднее" : "глубокое";
    return (
      <div className="detail-panel">
        <div className="detail-header">
          <h3 className="eq-detail-mag">M {eq.magnitude}</h3>
          <span className={`eq-detail-badge eq-detail-badge--${eq.magnitude >= 5.0 ? "danger" : eq.magnitude >= 4.5 ? "warning" : "info"}`}>
            {eq.magnitude >= 5.0 ? "Сильное" : eq.magnitude >= 4.5 ? "Ощутимое" : "Слабое"}
          </span>
        </div>
        <p className="detail-meta">{formatRelativeTime(eq.time)}</p>
        <p>{eq.place}</p>
        <p style={{ fontSize: 13, color: "#475569" }}>
          Глубина: {eq.depth} км ({depthLabel})
        </p>
        {eq.felt !== null && eq.felt > 0 && (
          <p style={{ fontSize: 13, color: "#475569" }}>Ощутили: ~{eq.felt} чел.</p>
        )}
        {eq.mmi !== null && eq.mmi > 0 && (
          <p style={{ fontSize: 13, color: "#475569" }}>Интенсивность (MMI): {eq.mmi}</p>
        )}
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          Источник: {eq.source === "usgs" ? "USGS" : "EMSC"} · ID: {eq.usgsId}
        </p>
      </div>
    );
  }

  return null;
}
