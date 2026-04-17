// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import type { HelpRequest, HelpResponse, HelpResponseStatus } from "@samur/shared";
import {
  HELP_CATEGORY_LABELS,
  HELP_REQUEST_STATUS_LABELS,
} from "@samur/shared";
import { formatRelativeTime } from "@samur/shared";
import { UrgencyBadge } from "./UrgencyBadge.js";
import { ImageLightbox } from "./ImageLightbox.js";
import { HelpChat } from "./HelpChat.js";

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
  onUpdateResponse: (id: string, status: HelpResponseStatus) => void;
  onClose: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  volunteer: "Волонтёр",
  coordinator: "Координатор",
  admin: "Администратор",
  resident: "Житель",
};

const RESPONSE_STATUS_LABELS: Record<HelpResponseStatus, string> = {
  responded: "Откликнулся",
  on_way: "В пути",
  arrived: "На месте",
  helped: "Помог",
  cancelled: "Отменил",
};

const RESPONSE_STATUS_CLASS: Record<HelpResponseStatus, string> = {
  responded: "response-pill response-pill--responded",
  on_way: "response-pill response-pill--on-way",
  arrived: "response-pill response-pill--arrived",
  helped: "response-pill response-pill--helped",
  cancelled: "response-pill response-pill--cancelled",
};

function formatRole(role?: string): string {
  if (!role) return "";
  return ROLE_LABELS[role] ?? role;
}

export function HelpDetailSheet({
  item, isNeed, currentUserId, onClaim, onUpdateResponse, onClose,
}: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const photos = item.photoUrls ?? [];

  const isAuthorMe = !!currentUserId && item.userId === currentUserId;
  const responses: HelpResponse[] = item.responses ?? [];
  const active = responses.filter((r) => r.status !== "cancelled");
  const myResponse = currentUserId
    ? responses.find((r) => r.userId === currentUserId) ?? null
    : null;
  const myActive = myResponse && myResponse.status !== "cancelled";

  // The phone to reach the requester: explicit contactPhone first, falling
  // back to the author's account phone (which the API only returns to
  // authorised callers — so "visible" implies "may use").
  const requesterPhone = item.contactPhone ?? item.author?.phone ?? null;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // What's the next step for a responder? Linear progression: responded →
  // on_way → arrived → helped. Each click advances one state.
  const nextStatus: HelpResponseStatus | null = (() => {
    if (!myActive || !myResponse) return null;
    switch (myResponse.status) {
      case "responded": return "on_way";
      case "on_way":    return "arrived";
      case "arrived":   return "helped";
      default:          return null;
    }
  })();
  const nextStatusLabel: Record<HelpResponseStatus, string> = {
    responded: "Откликнулся",
    on_way: "Я в пути",
    arrived: "Я на месте",
    helped: "Помог ✓",
    cancelled: "Отменил",
  };

  return createPortal(
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet sheet--tall" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />

        <div className="sheet-content" style={{ paddingTop: 8 }}>
          {photos.length > 0 && (
            <div className="detail-photos">
              {photos.map((url, i) => (
                <div key={i} className="detail-photo" onClick={() => setLightboxIndex(i)}>
                  <img src={url} alt="" loading="lazy" />
                </div>
              ))}
            </div>
          )}

          <div className="detail-header">
            <span className="detail-icon">{categoryIcons[item.category] ?? "📋"}</span>
            <span className="detail-category">{HELP_CATEGORY_LABELS[item.category]}</span>
            <UrgencyBadge value={item.urgency} kind="urgency" />
          </div>

          {item.status !== "open" && (
            <div className="detail-status-row">
              <span className="detail-status">{HELP_REQUEST_STATUS_LABELS[item.status]}</span>
              {active.length > 0 && (
                <span className="detail-status-count">
                  {active.length === 1 ? "1 отклик" : `${active.length} отклика`}
                </span>
              )}
            </div>
          )}

          {item.description && <p className="detail-desc">{item.description}</p>}

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

          {/* My-response state banner — the clearest signal "you did the thing,
              here's what's next". Only shown to the current responder. */}
          {myActive && myResponse && (
            <div className={`detail-response-banner detail-response-banner--${myResponse.status}`}>
              <div className="detail-response-banner-header">
                <span className="detail-response-banner-icon" aria-hidden="true">
                  {myResponse.status === "helped" ? "✓" : "→"}
                </span>
                <span>
                  {myResponse.status === "responded" && "Вы откликнулись"}
                  {myResponse.status === "on_way" && "Вы в пути"}
                  {myResponse.status === "arrived" && "Вы на месте"}
                  {myResponse.status === "helped" && "Вы помогли — спасибо"}
                </span>
              </div>
              <p className="detail-response-banner-body">
                {myResponse.status === "responded" && "Свяжитесь с заявителем и подтвердите, что выезжаете."}
                {myResponse.status === "on_way" && "Когда доедете — нажмите «Я на месте», чтобы заявитель это видел."}
                {myResponse.status === "arrived" && "Когда закончите — нажмите «Помог», чтобы закрыть отклик."}
                {myResponse.status === "helped" && "Отклик закрыт. Заявитель уведомлён."}
              </p>
            </div>
          )}

          {/* Contact info — hidden for the author viewing their own request. */}
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

          {/* Responders list — the heart of the multi-helper model. Every
              responder's name + status is visible to all viewers so they can
              coordinate ("three people already on the way — I'll pick another").
              Phones are only visible to the author and to the person's own row. */}
          {active.length > 0 && (
            <div className="detail-responders">
              <h4>Отклики ({active.length})</h4>
              <ul className="detail-responders-list">
                {active.map((r) => {
                  const isMine = r.userId === currentUserId;
                  return (
                    <li key={r.id} className={`detail-responder ${isMine ? "detail-responder--mine" : ""}`}>
                      <div className="detail-responder-main">
                        <div>
                          <div className="detail-responder-name">
                            {r.user?.name ?? "Волонтёр"}
                            {isMine && <span className="detail-responder-you"> · вы</span>}
                          </div>
                          <div className="detail-responder-meta">
                            {formatRole(r.user?.role)}
                            {" · "}
                            {formatRelativeTime(r.updatedAt)}
                          </div>
                        </div>
                        <span className={RESPONSE_STATUS_CLASS[r.status]}>
                          {RESPONSE_STATUS_LABELS[r.status]}
                        </span>
                      </div>
                      {r.user?.phone && (
                        <a href={`tel:${r.user.phone}`} className="detail-responder-phone">
                          {r.user.phone}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* In-app group chat — visible to the author, any non-cancelled
              responder, and coordinators/admins. Non-participants see the
              thread empty-state and a hint to respond first. */}
          {currentUserId && (
            <HelpChat
              requestId={item.id}
              currentUserId={currentUserId}
              canParticipate={!!(isAuthorMe || myActive)}
            />
          )}

          {/* Actions — structured so the most important next step is the
              primary button in each viewer state. */}
          <div className="detail-actions">
            {/* Not yet responded, not the author, logged in → respond */}
            {isNeed && !myActive && !isAuthorMe && currentUserId && (
              <button className="btn btn-primary btn-lg" onClick={() => onClaim(item.id)}>
                Откликнуться
              </button>
            )}
            {/* Active responder → advance status */}
            {myActive && nextStatus && (
              <button
                className="btn btn-primary btn-lg"
                onClick={() => onUpdateResponse(item.id, nextStatus)}
              >
                {nextStatusLabel[nextStatus]}
              </button>
            )}
            {/* Responder → call requester */}
            {myActive && requesterPhone && (
              <a href={`tel:${requesterPhone}`} className="btn btn-secondary btn-lg">
                Позвонить заявителю
              </a>
            )}
            {/* Active responder → cancel (unless already helped) */}
            {myActive && myResponse && myResponse.status !== "helped" && (
              <button
                className="btn btn-ghost btn-lg"
                onClick={() => onUpdateResponse(item.id, "cancelled")}
              >
                Отменить отклик
              </button>
            )}
            {/* Author → call first active volunteer */}
            {isAuthorMe && active[0]?.user?.phone && (
              <a href={`tel:${active[0].user.phone}`} className="btn btn-primary btn-lg">
                Позвонить волонтёру
              </a>
            )}
            {/* Stranger on an open request → call requester */}
            {!myActive && !isAuthorMe && requesterPhone && item.status === "open" && (
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
