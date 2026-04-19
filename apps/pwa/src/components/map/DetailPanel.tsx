// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useState } from "react";
import type { Incident, HelpRequest, Shelter, RiverLevel, EarthquakeEvent } from "@samur/shared";
import {
  INCIDENT_TYPE_LABELS,
  SEVERITY_LABELS,
  HELP_CATEGORY_LABELS,
  SHELTER_STATUS_LABELS,
  AMENITY_LABELS,
  formatRelativeTime,
  calculateDistance,
  formatDistance,
} from "@samur/shared";
import { UrgencyBadge } from "../UrgencyBadge.js";
import { ImageLightbox } from "../ImageLightbox.js";
import { RoutePickerSheet } from "../RoutePickerSheet.js";
import { RiverLevelDetail } from "./RiverLevelDetail.js";
import { useGeolocation } from "../../hooks/useGeolocation.js";
import { reverseGeocode } from "../../services/reverseGeocode.js";
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

/** Hook — returns a human-readable address. Prefers the stored one;
 * falls back to reverse-geocoding via Nominatim. Cached in-module so
 * rapid marker-taps don't re-fetch. */
function useDisplayAddress(
  storedAddress: string | null | undefined,
  lat: number,
  lng: number,
): string {
  const [geocoded, setGeocoded] = useState<string | null>(null);
  useEffect(() => {
    if (storedAddress) return;
    let cancelled = false;
    reverseGeocode(lat, lng).then((name) => {
      if (!cancelled) setGeocoded(name);
    });
    return () => { cancelled = true; };
  }, [storedAddress, lat, lng]);
  return storedAddress || geocoded || "Место уточняется...";
}

/** Stacked location row + "Построить маршрут" CTA. Shared between
 * incident, helpRequest, and shelter details. */
function LocationBlock({
  address, lat, lng, showDistance = true, label,
}: {
  address: string;
  lat: number;
  lng: number;
  showDistance?: boolean;
  label?: string;
}) {
  const [routeOpen, setRouteOpen] = useState(false);
  const { position } = useGeolocation();
  const stats = useMemo(() => {
    if (!position || !showDistance) return null;
    const meters = calculateDistance(position.lat, position.lng, lat, lng);
    const km = meters / 1000;
    const etaMin = Math.max(1, Math.round((km / 50) * 60));
    return { dist: formatDistance(meters), etaMin };
  }, [position, lat, lng, showDistance]);

  return (
    <div className="detail-location-block">
      <div className="detail-meta-row detail-meta-row--location">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <div className="detail-location">
          <span className="detail-location-name">{address}</span>
          {stats && (
            <span className="detail-location-eta">
              {stats.dist} · ≈{stats.etaMin} мин на авто
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        className="detail-route-btn"
        onClick={() => setRouteOpen(true)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="10" r="3"/>
          <path d="M12 2a8 8 0 0 0-8 8c0 5 8 12 8 12s8-7 8-12a8 8 0 0 0-8-8z"/>
        </svg>
        Построить маршрут
      </button>
      {routeOpen && (
        <RoutePickerSheet lat={lat} lng={lng} label={label ?? address} onClose={() => setRouteOpen(false)} />
      )}
    </div>
  );
}

/** Parse the "Ситуация: X, Y" prefix that the SOS follow-up writes
 * into the description so it can render as pills instead of as the
 * first paragraph of the free-text. */
function parseSituation(raw: string | null | undefined): { labels: string[]; text: string } {
  if (!raw) return { labels: [], text: "" };
  const body = raw.replace(/^SOS\s*(?:—|-)\s*/, "").trim();
  const m = body.match(/^Ситуация:\s*([^\n]+?)\s*(?:\n\s*\n|$)/);
  if (!m) return { labels: [], text: body };
  const labels = m[1].split(",").map((s) => s.trim()).filter(Boolean);
  return { labels, text: body.slice(m[0].length).trim() };
}

export function DetailPanel({ type, data, allRiverLevels, soilMoisture }: DetailPanelProps) {
  if (type === "incident") {
    return <IncidentDetail data={data as Incident & { photoUrls?: unknown }} />;
  }

  if (type === "helpRequest") {
    return <HelpRequestDetail data={data as HelpRequest & { photoUrls?: unknown }} />;
  }

  if (type === "shelter") {
    return <ShelterDetail data={data as Shelter} />;
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

function IncidentDetail({ data: inc }: { data: Incident & { photoUrls?: unknown } }) {
  const photos = parsePhotos(inc.photoUrls);
  const address = useDisplayAddress(inc.address, inc.lat, inc.lng);
  return (
    <div className="detail-panel">
      <PhotoGallery photos={photos} />
      <div className="detail-header">
        <h3>{INCIDENT_TYPE_LABELS[inc.type] ?? inc.type}</h3>
        <UrgencyBadge value={inc.severity} kind="severity" />
      </div>
      <p className="detail-meta-time">{formatRelativeTime(inc.createdAt)}</p>
      {inc.description && <p className="detail-desc">{inc.description}</p>}
      <LocationBlock address={address} lat={inc.lat} lng={inc.lng} label={INCIDENT_TYPE_LABELS[inc.type]} />
      <p className="text-muted detail-status-line">Статус: {SEVERITY_LABELS[inc.status] ?? inc.status}</p>
    </div>
  );
}

function HelpRequestDetail({ data: hr }: { data: HelpRequest & { photoUrls?: unknown } }) {
  const photos = parsePhotos(hr.photoUrls);
  const address = useDisplayAddress(hr.address, hr.lat, hr.lng);
  const { labels, text } = useMemo(() => parseSituation(hr.description), [hr.description]);
  return (
    <div className="detail-panel">
      <PhotoGallery photos={photos} />
      <div className="detail-header">
        <h3>{HELP_CATEGORY_LABELS[hr.category] ?? hr.category}</h3>
        <UrgencyBadge value={hr.urgency} kind="urgency" />
      </div>
      <p className="detail-meta-time">
        {hr.type === "offer" ? "Предлагает помощь" : "Нужна помощь"} · {formatRelativeTime(hr.createdAt)}
      </p>
      {labels.length > 0 && (
        <div className="detail-situations">
          {labels.map((label) => (
            <span key={label} className="detail-situation-pill">{label}</span>
          ))}
        </div>
      )}
      {text && <p className="detail-desc">{text}</p>}
      <LocationBlock address={address} lat={hr.lat} lng={hr.lng} label={HELP_CATEGORY_LABELS[hr.category]} />
      {(hr.contactName || hr.contactPhone) && (
        <div className="detail-contact-row">
          {hr.contactName && <span className="detail-contact-inline-name">{hr.contactName}</span>}
          {hr.contactName && hr.contactPhone && " · "}
          {hr.contactPhone && (
            <a href={`tel:${hr.contactPhone}`} className="btn btn-primary detail-call-btn">
              Позвонить: {hr.contactPhone}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function ShelterDetail({ data: s }: { data: Shelter }) {
  const address = useDisplayAddress(s.address, s.lat, s.lng);
  return (
    <div className="detail-panel">
      <div className="detail-header">
        <h3>{s.name}</h3>
        <span className={`status-badge status-badge--${s.status}`}>
          {SHELTER_STATUS_LABELS[s.status]}
        </span>
      </div>
      <p>Заполненность: {s.currentOccupancy} / {s.capacity}</p>
      {s.amenities.length > 0 && (
        <p>Удобства: {s.amenities.map((a) => AMENITY_LABELS[a] ?? a).join(", ")}</p>
      )}
      <LocationBlock address={address} lat={s.lat} lng={s.lng} label={s.name} />
      {s.contactPhone && (
        <a href={`tel:${s.contactPhone}`} className="btn btn-secondary" style={{ marginTop: 8 }}>
          {s.contactPhone}
        </a>
      )}
    </div>
  );
}
