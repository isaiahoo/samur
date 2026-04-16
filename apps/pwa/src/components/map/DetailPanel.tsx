// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
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
import { ImageLightbox } from "../ImageLightbox.js";
import { RiverLevelDetail } from "./RiverLevelDetail.js";
import type { SoilMoisturePoint } from "./geoJsonHelpers.js";

interface DetailPanelProps {
  type: string;
  data: unknown;
  allRiverLevels?: RiverLevel[];
  soilMoisture?: SoilMoisturePoint[];
  onClose: () => void;
}

/** Parse photoUrls which may be a JSON string (from GeoJSON) or an array */
function parsePhotos(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((u) => typeof u === "string" && u.length > 0);
  if (typeof raw === "string" && raw.length > 0) {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

function PhotoGallery({ photos }: { photos: string[] }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  if (photos.length === 0) return null;
  return (
    <>
      <div className="detail-photos">
        {photos.map((url, i) => (
          <div key={i} className="detail-photo" onClick={() => setLightboxIndex(i)}>
            <img src={url} alt="" loading="lazy" />
          </div>
        ))}
      </div>
      {lightboxIndex !== null && (
        <ImageLightbox urls={photos} initialIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      )}
    </>
  );
}

export function DetailPanel({ type, data, allRiverLevels, soilMoisture }: DetailPanelProps) {
  if (type === "incident") {
    const inc = data as Incident & { photoUrls?: unknown };
    const photos = parsePhotos(inc.photoUrls);
    return (
      <div className="detail-panel">
        <PhotoGallery photos={photos} />
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
    const hr = data as HelpRequest & { photoUrls?: unknown };
    const photos = parsePhotos(hr.photoUrls);
    return (
      <div className="detail-panel">
        <PhotoGallery photos={photos} />
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
          <h3 className="eq-detail-mag">
            <span className="eq-detail-mag-value">{eq.magnitude}</span>
            <span className="eq-detail-mag-unit">Магнитуда</span>
          </h3>
          <span className={`eq-detail-badge eq-detail-badge--${eq.magnitude >= 5.0 ? "danger" : eq.magnitude >= 4.5 ? "warning" : "info"}`}>
            {eq.magnitude >= 5.0 ? "Сильное" : eq.magnitude >= 4.5 ? "Ощутимое" : "Слабое"}
          </span>
        </div>
        <p className="detail-meta">{formatRelativeTime(eq.time)}</p>
        <p className="eq-detail-place">{eq.place}</p>
        <p className="eq-detail-info">
          Глубина: {eq.depth} км ({depthLabel})
        </p>
        {eq.felt !== null && eq.felt > 0 && (
          <p className="eq-detail-info">Ощутили: ~{eq.felt} чел.</p>
        )}
        {eq.mmi !== null && eq.mmi > 0 && (
          <p className="eq-detail-info">Интенсивность: {Math.round(eq.mmi)} баллов</p>
        )}
        <p className="eq-detail-source">
          Источник: {eq.source === "usgs" ? "USGS" : "EMSC"} · ID: {eq.usgsId}
        </p>
      </div>
    );
  }

  return null;
}
