// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { HelpRequest, HelpResponse, HelpResponseStatus } from "@samur/shared";
import {
  HELP_CATEGORY_LABELS,
  HELP_REQUEST_STATUS_LABELS,
  calculateDistance,
  formatDistance,
} from "@samur/shared";
import { formatRelativeTime } from "@samur/shared";
import { UrgencyBadge } from "./UrgencyBadge.js";
import { ImageLightbox } from "./ImageLightbox.js";
import { HelpChat } from "./HelpChat.js";
import { HelpConfirmationCard } from "./HelpConfirmationCard.js";
import { HelpProgressRail } from "./HelpProgressRail.js";
import { RoutePickerSheet } from "./RoutePickerSheet.js";
import { confirmAction, useUIStore } from "../store/ui.js";
import { removeHelpParticipant, ApiError } from "../services/api.js";
import { useGeolocation } from "../hooks/useGeolocation.js";
import { reverseGeocode } from "../services/reverseGeocode.js";

const categoryIcons: Record<string, string> = {
  rescue: "🆘", shelter: "🏠", food: "🍞", water: "💧",
  medicine: "💊", equipment: "🔧", transport: "🚗", labor: "💪",
  generator: "⚡", pump: "🔄",
  childcare: "👶", petcare: "🐾", tutoring: "📚", errands: "🛒",
  repair: "🛠️", giveaway: "🎁", other: "📋",
};

interface Props {
  item: HelpRequest;
  isNeed: boolean;
  currentUserId: string | null;
  onClaim: (id: string) => void;
  onUpdateResponse: (id: string, status: HelpResponseStatus) => void;
  onClose: () => void;
}

// Only elevated roles get a visible label — for regular users the
// resident/volunteer distinction is meaningless (everyone can both
// request and offer help). Trust in the future comes from action
// history (stats / achievements), not a label picked at signup.
const ELEVATED_ROLE_LABELS: Record<string, string> = {
  coordinator: "Координатор",
  admin: "Администратор",
};

/** Marker stored on the synthetic history entry we push when the sheet
 * opens. Used by both popstate (to ignore non-ours) and the unmount
 * cleanup (to consume the entry only when it's still on top). */
const SHEET_STATE_MARKER = "kunakSheet";

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
  return ELEVATED_ROLE_LABELS[role] ?? "";
}

// Compact record line under the responder's name. The foundation of the
// trust signal that will later be enriched with achievement badges.
// Intentionally minimal on zero-activity users so "new to the platform"
// doesn't read as a negative signal.
const MONTHS_RU = [
  "янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек",
];
function formatJoined(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `с ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`;
}
function statsLine(stats?: { helpsCompleted: number; requestsResolved: number; joinedAt: string }): string {
  if (!stats) return "";
  const bits: string[] = [];
  if (stats.helpsCompleted > 0) {
    bits.push(
      stats.helpsCompleted === 1
        ? "1 помощь"
        : stats.helpsCompleted < 5
          ? `${stats.helpsCompleted} помощи`
          : `${stats.helpsCompleted} помощей`,
    );
  }
  if (stats.requestsResolved > 0) {
    bits.push(`${stats.requestsResolved} заявок закрыто`);
  }
  bits.push(formatJoined(stats.joinedAt));
  return bits.filter(Boolean).join(" · ");
}

/** Shown on the responder's own rail once they've marked помог — lets
 * them know the author's "спасибо" is pending. No pressure, no timer. */
function ResponderWaitingForThanks({ response }: { response: HelpResponse }) {
  if (response.confirmedAt) {
    return (
      <div className="kunak-waiting kunak-waiting--thanked">
        🤝 Вам сказали спасибо
      </div>
    );
  }
  if (response.rejectedAt) {
    return (
      <div className="kunak-waiting kunak-waiting--rejected">
        Автор отметил, что что-то не получилось. Если это ошибка — напишите координатору.
      </div>
    );
  }
  return (
    <div className="kunak-waiting">
      Ждём спасибо от автора · помощь засчитана вам как заявленная
    </div>
  );
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
  const [routePickerOpen, setRoutePickerOpen] = useState(false);
  // Reverse-geocoded place name. Null while loading / on failure;
  // UI only shows this when item.address is missing, so silent
  // failure is acceptable.
  const [geocoded, setGeocoded] = useState<string | null>(null);
  const navigate = useNavigate();
  const { position } = useGeolocation();
  const photos = item.photoUrls ?? [];

  // Only fetch if we need to — stored address wins over geocoding.
  useEffect(() => {
    if (item.address) return;
    let cancelled = false;
    reverseGeocode(item.lat, item.lng).then((name) => {
      if (!cancelled) setGeocoded(name);
    });
    return () => { cancelled = true; };
  }, [item.address, item.lat, item.lng]);

  // Parse the SOS follow-up's "Ситуация: X, Y" prefix out of the
  // description so the categories render as pills above the free
  // text instead of as a raw first line. See SOSButton.composeDescription.
  const { situationLabels, freeText } = useMemo(() => {
    const raw = item.description ?? "";
    // Strip the leading "SOS — " prefix the server prepends.
    const body = raw.replace(/^SOS\s*(?:—|-)\s*/, "").trim();
    const m = body.match(/^Ситуация:\s*([^\n]+?)\s*(?:\n\s*\n|$)/);
    if (!m) return { situationLabels: [] as string[], freeText: body };
    const labels = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    const rest = body.slice(m[0].length).trim();
    return { situationLabels: labels, freeText: rest };
  }, [item.description]);

  // Distance + rough driving ETA, shown only when we have the user's
  // position. 50 km/h is a generous average for flooded/rural roads
  // in Dagestan — better to promise 10 min and arrive in 7 than the
  // other way around. Not shown when the request is the viewer's own.
  const locationStats = useMemo(() => {
    if (!position) return null;
    const meters = calculateDistance(position.lat, position.lng, item.lat, item.lng);
    const km = meters / 1000;
    const etaMin = Math.max(1, Math.round((km / 50) * 60));
    return { dist: formatDistance(meters), etaMin };
  }, [position, item.lat, item.lng]);

  const openProfile = (userId?: string) => {
    if (!userId) return;
    // Don't use history.back() here — it races with the follow-up
    // navigate(). Rewrite our synthetic entry to a neutral state instead
    // (the unmount cleanup below checks the marker before popping, so a
    // cleared marker means no double-back on teardown).
    if (window.history.state?.[SHEET_STATE_MARKER]) {
      window.history.replaceState(null, "");
    }
    onClose();
    // Defer so the overlay's exit animation has a frame to start before
    // routing triggers a full re-render.
    setTimeout(() => navigate(`/profile/${userId}`), 0);
  };

  const isAuthorMe = !!currentUserId && item.userId === currentUserId;
  const showToast = useUIStore((s) => s.showToast);
  const responses: HelpResponse[] = item.responses ?? [];
  const active = responses.filter((r) => r.status !== "cancelled");

  const handleRemoveResponder = async (targetUserId: string, targetName: string | null) => {
    const ok = await confirmAction({
      title: "Удалить участника из обсуждения?",
      message: `${targetName ?? "Участник"} потеряет доступ к чату и отклик будет отменён.`,
      confirmLabel: "Удалить",
      kind: "destructive",
    });
    if (!ok) return;
    try {
      await removeHelpParticipant(item.id, targetUserId);
      showToast("Участник удалён", "success");
      // help_response:changed socket event refreshes the parent list —
      // the responder row disappears on the next render via filter.
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Не удалось удалить участника";
      showToast(msg, "error");
    }
  };
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

  // Bind the sheet to browser history so the hardware / browser back button
  // closes the sheet instead of navigating off the Help page. Push one
  // synthetic entry on mount; popstate while leaving it → close. Explicit
  // close goes through history.back(). If the sheet unmounts programmatically
  // (parent cleared detailItem after a cancel) we also consume the entry so
  // it doesn't strand on the stack and swallow a future back-press.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    window.history.pushState({ [SHEET_STATE_MARKER]: true }, "");
    const onPopState = (e: PopStateEvent) => {
      // e.state is the state we're landing on after the pop. If it's our
      // marker, the popstate originated elsewhere (nested navigation) and
      // we should leave the sheet alone.
      if (e.state?.[SHEET_STATE_MARKER]) return;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (window.history.state?.[SHEET_STATE_MARKER]) {
        window.history.back();
      }
    };
  }, []);
  const requestClose = () => {
    if (window.history.state?.[SHEET_STATE_MARKER]) {
      window.history.back();
    } else {
      onCloseRef.current();
    }
  };

  // Ref to the scrollable content so we can jump to the bottom on open when
  // there are already messages — the user lands on the latest line of the
  // conversation, not at the top of the meta they've already seen.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const initialUnread = item.unreadMessages ?? 0;
  useEffect(() => {
    if (initialUnread > 0 && scrollRef.current) {
      // Delay one frame so HelpChat has painted its messages.
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
    // Only on open — subsequent state changes use sticky composer behaviour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

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
    <div className="sheet-overlay" onClick={requestClose}>
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
              onClick={async () => {
                const ok = await confirmAction({
                  title: "Отменить отклик?",
                  message: "Чат закроется, а заявитель увидит, что вы не сможете помочь.",
                  confirmLabel: "Отменить отклик",
                  kind: "destructive",
                });
                if (ok) onUpdateResponse(item.id, "cancelled");
              }}
            >
              Отменить
            </button>
          )}
        </div>

        <div className="sheet-content" ref={scrollRef} style={{ paddingTop: 8 }}>
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
          {myActive && myResponse && myResponse.status === "helped" && (
            <ResponderWaitingForThanks response={myResponse} />
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

          {situationLabels.length > 0 && (
            <div className="detail-situations">
              {situationLabels.map((label) => (
                <span key={label} className="detail-situation-pill">{label}</span>
              ))}
            </div>
          )}

          {freeText && <p className="detail-desc">{freeText}</p>}

          {/* Condensed meta — address, time, contact all in one group */}
          <div className="detail-meta">
            <div className="detail-meta-row detail-meta-row--location">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <div className="detail-location">
                <span className="detail-location-name">
                  {item.address ?? geocoded ?? "Место уточняется..."}
                </span>
                {locationStats && !isAuthorMe && (
                  <span className="detail-location-eta">
                    {locationStats.dist} · ≈{locationStats.etaMin} мин на авто
                  </span>
                )}
              </div>
            </div>

            {!isAuthorMe && (
              <button
                type="button"
                className="detail-route-btn"
                onClick={() => setRoutePickerOpen(true)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="10" r="3"/>
                  <path d="M12 2a8 8 0 0 0-8 8c0 5 8 12 8 12s8-7 8-12a8 8 0 0 0-8-8z"/>
                </svg>
                Построить маршрут
              </button>
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
                        {r.user?.id ? (
                          <button
                            type="button"
                            className="detail-responder-name detail-responder-name--link"
                            onClick={() => openProfile(r.user!.id)}
                          >
                            {r.user.name ?? "Участник"}
                          </button>
                        ) : (
                          <div className="detail-responder-name">{r.user?.name ?? "Участник"}</div>
                        )}
                        <div className="detail-responder-meta">
                          {(() => {
                            const role = formatRole(r.user?.role);
                            return role ? `${role} · ${formatRelativeTime(r.updatedAt)}` : formatRelativeTime(r.updatedAt);
                          })()}
                        </div>
                        {r.user?.stats && statsLine(r.user.stats) && (
                          <div className="detail-responder-stats">
                            {statsLine(r.user.stats)}
                          </div>
                        )}
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
                    {isAuthorMe && r.user?.id && (
                      <button
                        type="button"
                        className="detail-responder-remove"
                        onClick={() => handleRemoveResponder(r.user!.id, r.user?.name ?? null)}
                      >
                        Удалить из обсуждения
                      </button>
                    )}
                    {isAuthorMe && r.status === "helped" && (
                      <HelpConfirmationCard
                        requestId={item.id}
                        response={r}
                        onChange={async () => { /* socket refresh flows into item prop */ }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {currentUserId && (
            <HelpChat
              requestId={item.id}
              currentUserId={currentUserId}
              canParticipate={!!(isAuthorMe || myActive)}
              stickyComposer
              // Active responders + 1 for the author. Matches the
              // server-side resolveMessageParticipants fan-out list,
              // so the disclosure agrees with who actually receives
              // each message.
              activeParticipantCount={active.length + 1}
              onOpenProfile={openProfile}
            />
          )}
        </div>

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

      {routePickerOpen && (
        <RoutePickerSheet
          lat={item.lat}
          lng={item.lng}
          label={item.address ?? geocoded ?? undefined}
          onClose={() => setRoutePickerOpen(false)}
        />
      )}
    </div>,
    document.body,
  );
}
