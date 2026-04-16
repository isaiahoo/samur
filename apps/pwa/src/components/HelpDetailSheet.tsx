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
  currentUserId: string | null;
  onClaim: (id: string) => void;
  onClose: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  volunteer: "Волонтёр",
  coordinator: "Координатор",
  admin: "Администратор",
  resident: "Житель",
};

export function HelpDetailSheet({ item, isNeed, currentUserId, onClaim, onClose }: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const photos = item.photoUrls ?? [];

  const isAuthorMe = !!currentUserId && item.userId === currentUserId;
  const isClaimerMe = !!currentUserId && item.claimedBy === currentUserId;
  const isClaimed = item.status === "claimed" || item.status === "in_progress";

  // The phone to reach the requester: explicit contactPhone first, falling
  // back to the author's account phone (which the API only returns to
  // authorised callers — so "visible" implies "may use").
  const requesterPhone = item.contactPhone ?? item.author?.phone ?? null;
  const volunteerPhone = item.claimer?.phone ?? null;

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

          {/* Post-claim confirmation — only visible to the volunteer who just
              responded. Big, unmissable: the most important next step is now
              calling the requester, so we lead with exactly that. */}
          {isClaimerMe && isClaimed && (
            <div className="detail-response-banner">
              <div className="detail-response-banner-header">
                <span className="detail-response-banner-icon" aria-hidden="true">✓</span>
                <span>Вы откликнулись</span>
              </div>
              <p className="detail-response-banner-body">
                Свяжитесь с заявителем{item.contactName ? ` (${item.contactName})` : ""}
                {" "}и договоритесь о встрече. Если не получилось дозвониться, координаторы увидят ваш отклик в админке.
              </p>
            </div>
          )}

          {/* Contact info — the requester. Hidden for the requester viewing
              their own request (they know their own number). */}
          {!isAuthorMe && (
            <div className="detail-contact">
              <h4>Контакт заявителя</h4>
              {item.contactName && <p className="detail-contact-name">{item.contactName}</p>}
              {requesterPhone ? (
                <a href={`tel:${requesterPhone}`} className="detail-contact-phone">
                  {requesterPhone}
                  {!item.contactPhone && item.author?.phone && (
                    <span className="detail-contact-hint"> · телефон автора</span>
                  )}
                </a>
              ) : !item.contactName ? (
                <p className="detail-contact-empty">Не указано — заявитель увидит ваш отклик в приложении</p>
              ) : null}
            </div>
          )}

          {/* Volunteer who responded — shown to the requester so they know who
              is on the way. Hidden for the volunteer themselves (they know
              they claimed it; the confirmation banner above serves them). */}
          {isClaimed && item.claimer && !isClaimerMe && (
            <div className="detail-claimer">
              <h4>Откликнулся</h4>
              <p className="detail-claimer-name">
                {item.claimer.name ?? "Волонтёр"}
                {item.claimer.role && ROLE_LABELS[item.claimer.role] && (
                  <span className="detail-claimer-role"> · {ROLE_LABELS[item.claimer.role]}</span>
                )}
              </p>
              {item.claimer.phone ? (
                <a href={`tel:${item.claimer.phone}`} className="detail-contact-phone">
                  {item.claimer.phone}
                </a>
              ) : (
                <p className="detail-contact-empty">Телефон скрыт — волонтёр свяжется сам</p>
              )}
            </div>
          )}

          {/* Actions — scaled to the viewer. The claim button only fires for
              logged-in non-authors, the primary call CTA matches who's looking. */}
          <div className="detail-actions">
            {isNeed && item.status === "open" && !isAuthorMe && (
              <button
                className="btn btn-primary btn-lg"
                onClick={() => onClaim(item.id)}
              >
                Откликнуться
              </button>
            )}
            {/* Claimer → big primary button to call the requester */}
            {isClaimerMe && requesterPhone && (
              <a href={`tel:${requesterPhone}`} className="btn btn-primary btn-lg">
                Позвонить заявителю
              </a>
            )}
            {/* Author viewing their claimed request → big primary to call volunteer */}
            {isAuthorMe && isClaimed && volunteerPhone && (
              <a href={`tel:${volunteerPhone}`} className="btn btn-primary btn-lg">
                Позвонить волонтёру
              </a>
            )}
            {/* Stranger viewing a claimed request — still surface the requester
                phone as a secondary action if they want to help too. */}
            {!isClaimerMe && !isAuthorMe && requesterPhone && item.status === "open" && (
              <a href={`tel:${requesterPhone}`} className="btn btn-secondary btn-lg">
                Позвонить
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
