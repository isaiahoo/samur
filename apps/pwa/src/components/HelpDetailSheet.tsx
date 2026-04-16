// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import type { HelpRequest } from "@samur/shared";
import {
  HELP_CATEGORY_LABELS,
  HELP_REQUEST_STATUS_LABELS,
  URGENCY_LABELS,
} from "@samur/shared";
import { formatRelativeTime } from "@samur/shared";
import { UrgencyBadge } from "./UrgencyBadge.js";
import { ImageLightbox } from "./ImageLightbox.js";

const categoryIcons: Record<string, string> = {
  rescue: "🆘", shelter: "🏠", food: "🍞", water: "💧",
  medicine: "💊", equipment: "🔧", transport: "🚗", labor: "💪",
  generator: "⚡", pump: "🔄",
};

interface Props {
  item: HelpRequest;
  isNeed: boolean;
  onClaim: (id: string) => void;
  onClose: () => void;
}

export function HelpDetailSheet({ item, isNeed, onClaim, onClose }: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const photos = item.photoUrls ?? [];

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return createPortal(
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet sheet--tall" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />

        <div className="sheet-content" style={{ paddingTop: 8 }}>
          {/* Photo gallery */}
          {photos.length > 0 && (
            <div className="detail-photos">
              {photos.map((url, i) => (
                <div
                  key={i}
                  className="detail-photo"
                  onClick={() => setLightboxIndex(i)}
                >
                  <img src={url} alt="" loading="lazy" />
                </div>
              ))}
            </div>
          )}

          {/* Header */}
          <div className="detail-header">
            <span className="detail-icon">{categoryIcons[item.category] ?? "📋"}</span>
            <span className="detail-category">{HELP_CATEGORY_LABELS[item.category]}</span>
            <UrgencyBadge value={item.urgency} kind="urgency" />
          </div>

          {/* Status */}
          {item.status !== "open" && (
            <div className="detail-status-row">
              <span className="detail-status">{HELP_REQUEST_STATUS_LABELS[item.status]}</span>
            </div>
          )}

          {/* Description */}
          {item.description && (
            <p className="detail-desc">{item.description}</p>
          )}

          {/* Meta */}
          <div className="detail-meta">
            {item.address && (
              <div className="detail-meta-row">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span>{item.address}</span>
              </div>
            )}
            <div className="detail-meta-row">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
              <span>{formatRelativeTime(item.createdAt)}</span>
            </div>
          </div>

          {/* Contact info — the requester */}
          <div className="detail-contact">
            <h4>Контакт заявителя</h4>
            {item.contactName && <p className="detail-contact-name">{item.contactName}</p>}
            {item.contactPhone ? (
              <a href={`tel:${item.contactPhone}`} className="detail-contact-phone">
                {item.contactPhone}
              </a>
            ) : item.author?.phone ? (
              // Fallback to author's account phone when no explicit contactPhone
              // was provided (typical for SOS / panic-button submissions).
              <a href={`tel:${item.author.phone}`} className="detail-contact-phone">
                {item.author.phone}
                <span className="detail-contact-hint"> · телефон автора</span>
              </a>
            ) : !item.contactName ? (
              <p className="detail-contact-empty">Не указано</p>
            ) : null}
          </div>

          {/* Claimer block — visible once someone has responded */}
          {(item.status === "claimed" || item.status === "in_progress") && item.claimer && (
            <div className="detail-claimer">
              <h4>Откликнулся</h4>
              <p className="detail-claimer-name">
                {item.claimer.name ?? "Волонтёр"}
                {item.claimer.role === "volunteer" && <span className="detail-claimer-role"> · Волонтёр</span>}
                {item.claimer.role === "coordinator" && <span className="detail-claimer-role"> · Координатор</span>}
                {item.claimer.role === "admin" && <span className="detail-claimer-role"> · Администратор</span>}
              </p>
              {item.claimer.phone && (
                <a href={`tel:${item.claimer.phone}`} className="detail-contact-phone">
                  {item.claimer.phone}
                </a>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="detail-actions">
            {isNeed && item.status === "open" && (
              <button
                className="btn btn-primary btn-lg"
                onClick={() => { onClaim(item.id); onClose(); }}
              >
                Откликнуться
              </button>
            )}
            {(() => {
              // Primary call target depends on who's looking:
              // - If you already claimed (or are the author), the most useful
              //   number is on the claimer block above. Still, surface a
              //   fallback call button to the reachable phone.
              const fallbackPhone = item.contactPhone ?? item.author?.phone ?? null;
              return fallbackPhone && (
                <a href={`tel:${fallbackPhone}`} className="btn btn-secondary btn-lg">
                  Позвонить заявителю
                </a>
              );
            })()}
            {item.claimer?.phone && (
              <a href={`tel:${item.claimer.phone}`} className="btn btn-secondary btn-lg">
                Позвонить волонтёру
              </a>
            )}
          </div>
        </div>
      </div>

      {lightboxIndex !== null && (
        <ImageLightbox
          urls={photos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>,
    document.body,
  );
}
