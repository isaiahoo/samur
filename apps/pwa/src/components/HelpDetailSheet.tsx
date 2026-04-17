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
import { HelpProgressRail } from "./HelpProgressRail.js";
import { useSocketEvent } from "../hooks/useSocket.js";

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

// Colored circle with 1-2 letter initials — used next to responder names.
function Avatar({ name, size = 32 }: { name?: string | null; size?: number }) {
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  // Deterministic hue from the name so the same person keeps the same colour.
  const hue = name
    ? [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
    : 220;
  return (
    <span
      className="responder-avatar"
      style={{
        width: size, height: size, lineHeight: `${size}px`,
        background: `hsl(${hue} 60% 45%)`,
      }}
    >
      {initial}
    </span>
  );
}

export function HelpDetailSheet({
  item, isNeed, currentUserId, onClaim, onUpdateResponse, onClose,
}: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Tab state: "details" is the default, "chat" focuses the thread on the
  // full sheet height. Each tab gets all of .sheet-content's vertical space
  // so a long chat no longer forces the user to scroll past the meta.
  const [activeTab, setActiveTab] = useState<"details" | "chat">("details");
  // Local unread counter — bumps on socket events while we're not on the
  // chat tab, resets when the user visits it.
  const [newSinceDetails, setNewSinceDetails] = useState(0);
  const photos = item.photoUrls ?? [];

  const isAuthorMe = !!currentUserId && item.userId === currentUserId;
  const responses: HelpResponse[] = item.responses ?? [];
  const active = responses.filter((r) => r.status !== "cancelled");
  const myResponse = currentUserId
    ? responses.find((r) => r.userId === currentUserId) ?? null
    : null;
  const myActive = myResponse && myResponse.status !== "cancelled";

  // Hide the caller's own responder row — their state is already in the rail.
  const othersActive = active.filter((r) => r.userId !== currentUserId);

  // The phone to reach the requester: explicit contactPhone first, falling
  // back to the author's account phone (API only returns it to authorised
  // callers — so "visible" implies "may use").
  const requesterPhone = item.contactPhone ?? item.author?.phone ?? null;
  const displayName = item.contactName ?? item.author?.name ?? null;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Bump unread counter when a message arrives while the user is off the
  // chat tab. Reset when they switch to it — HelpChat itself marks-read
  // on mount, so the server watermark also advances.
  useSocketEvent("help_message:created", (msg) => {
    if (msg.helpRequestId !== item.id) return;
    if (msg.authorId === currentUserId) return; // don't badge your own sends
    if (activeTab !== "chat") setNewSinceDetails((n) => n + 1);
  });
  const goToChat = () => {
    setNewSinceDetails(0);
    setActiveTab("chat");
  };
  // Combined unread: server-computed baseline (what we didn't see before
  // opening the sheet) + anything that arrived while in details view.
  const initialUnread = item.unreadMessages ?? 0;
  const chatBadge = activeTab === "chat" ? 0 : initialUnread + newSinceDetails;
  const totalMessages = initialUnread + newSinceDetails; // for the tab counter when no unread

  // Advance-state logic.
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
    responded: "—",
    on_way: "Я в пути",
    arrived: "Я на месте",
    helped: "Помог ✓",
    cancelled: "—",
  };

  // Primary CTA for the bottom bar depends on who's looking.
  const primaryAction: { label: string; onClick: () => void } | null = (() => {
    if (myActive && nextStatus) {
      return {
        label: nextStatusLabel[nextStatus],
        onClick: () => onUpdateResponse(item.id, nextStatus),
      };
    }
    if (!myActive && !isAuthorMe && currentUserId && isNeed
        && item.status !== "completed" && item.status !== "cancelled") {
      return { label: "Откликнуться", onClick: () => onClaim(item.id) };
    }
    return null;
  })();

  const secondaryPhone = (() => {
    if (isAuthorMe) return othersActive[0]?.user?.phone ?? null;
    return requesterPhone;
  })();
  const secondaryLabel = isAuthorMe ? "Позвонить волонтёру" : "Позвонить заявителю";

  return createPortal(
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet sheet--tall" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />

        {/* Compact top bar — category, urgency, cancel link (if responder). */}
        <div className="detail-topbar">
          <span className="detail-icon">{categoryIcons[item.category] ?? "📋"}</span>
          <span className="detail-category">{HELP_CATEGORY_LABELS[item.category]}</span>
          <UrgencyBadge value={item.urgency} kind="urgency" />
          {myActive && myResponse && myResponse.status !== "helped" && (
            <button
              className="detail-cancel-link"
              onClick={() => onUpdateResponse(item.id, "cancelled")}
            >
              Отменить
            </button>
          )}
        </div>

        {/* Tabs — Details / Chat. Chat gets full sheet height on tap so
            long threads don't force the user to scroll past the meta. */}
        <div className="detail-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === "details"}
            className={`detail-tab ${activeTab === "details" ? "detail-tab--active" : ""}`}
            onClick={() => setActiveTab("details")}
          >
            <svg className="detail-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            Детали
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "chat"}
            className={`detail-tab ${activeTab === "chat" ? "detail-tab--active" : ""}`}
            onClick={goToChat}
          >
            <svg className="detail-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Обсуждение
            {totalMessages > 0 && activeTab === "chat" && (
              <span className="detail-tab-count"> · {totalMessages}</span>
            )}
            {chatBadge > 0 && (
              <span className="detail-tab-badge" aria-label={`${chatBadge} непрочитанных`}>
                {chatBadge > 9 ? "9+" : chatBadge}
              </span>
            )}
          </button>
        </div>

        {activeTab === "chat" ? (
          <div className="sheet-content sheet-content--chat">
            {currentUserId && (
              <HelpChat
                requestId={item.id}
                currentUserId={currentUserId}
                canParticipate={!!(isAuthorMe || myActive)}
                fullHeight
              />
            )}
          </div>
        ) : (
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

          {/* Progress rail — the main "where am I" signal for the responder. */}
          {myActive && myResponse && (
            <HelpProgressRail status={myResponse.status} perspective="self" />
          )}
          {/* Author view with a primary responder → show their progress. */}
          {isAuthorMe && othersActive[0] && (
            <HelpProgressRail status={othersActive[0].status} perspective="author" />
          )}

          {/* Legacy status (only if not in the responder/author-with-responder state) */}
          {!myActive && !isAuthorMe && item.status !== "open" && (
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

          {/* Condensed meta — address, time, contact all in one group */}
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
            {!isAuthorMe && (displayName || requesterPhone) && (
              <div className="detail-meta-row detail-meta-row--contact">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span>
                  {displayName && <span className="detail-contact-inline-name">{displayName}</span>}
                  {displayName && requesterPhone && " · "}
                  {requesterPhone && (
                    <a href={`tel:${requesterPhone}`} className="detail-contact-inline-phone">
                      {requesterPhone}
                    </a>
                  )}
                </span>
              </div>
            )}
          </div>

          {/* Other responders — the caller's own row is hidden (it's in the rail).
              When viewer is stranger, all active responders are shown. */}
          {othersActive.length > 0 && (
            <div className="detail-responders">
              <h4>
                Отклики ({active.length})
                {myActive && <span className="detail-responders-hint"> · ваш отклик выше</span>}
              </h4>
              <ul className="detail-responders-list">
                {othersActive.map((r) => (
                  <li key={r.id} className="detail-responder">
                    <div className="detail-responder-main">
                      <Avatar name={r.user?.name} size={32} />
                      <div className="detail-responder-body">
                        <div className="detail-responder-name">{r.user?.name ?? "Волонтёр"}</div>
                        <div className="detail-responder-meta">
                          {formatRole(r.user?.role)} · {formatRelativeTime(r.updatedAt)}
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
                ))}
              </ul>
            </div>
          )}

          {/* Light-weight preview: if there's a chat, nudge the user to the
              Обсуждение tab. Avoids duplicating the thread in the Details view. */}
          {currentUserId && (initialUnread + newSinceDetails > 0) && (
            <button
              className="detail-chat-jump"
              onClick={goToChat}
              aria-label="Перейти к обсуждению"
            >
              <span className="detail-chat-jump-dot" aria-hidden="true" />
              <span>
                {initialUnread + newSinceDetails} новых в обсуждении
              </span>
              <span className="detail-chat-jump-arrow" aria-hidden="true">›</span>
            </button>
          )}
        </div>
        )}

        {/* Sticky bottom action bar — always visible regardless of scroll.
            Primary CTA is the state-advance button or "Откликнуться". The
            secondary slot is the phone (icon-only). Cancel lives in the top bar. */}
        {(primaryAction || secondaryPhone) && (
          <div className="sheet-footer-sticky">
            {primaryAction && (
              <button className="btn btn-primary btn-lg sheet-footer-primary" onClick={primaryAction.onClick}>
                {primaryAction.label}
              </button>
            )}
            {secondaryPhone && (
              <a
                href={`tel:${secondaryPhone}`}
                className="sheet-footer-phone"
                aria-label={secondaryLabel}
                title={secondaryLabel}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
              </a>
            )}
          </div>
        )}
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
