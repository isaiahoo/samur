// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useCallback, useRef, useMemo, type CSSProperties } from "react";
import type { HelpRequest } from "@samur/shared";
import {
  HELP_CATEGORY_LABELS,
  HELP_REQUEST_STATUS_LABELS,
  HELP_CATEGORIES,
} from "@samur/shared";
import { formatRelativeTime } from "@samur/shared";
import {
  getHelpRequests,
  respondToHelpRequest,
  updateMyHelpResponse,
  cancelMyHelpResponse,
} from "../services/api.js";
import type { HelpResponseStatus } from "@samur/shared";
import { UrgencyBadge } from "../components/UrgencyBadge.js";
import { CategoryChip } from "../components/CategoryChip.js";
import { CategoryIcon } from "../components/CategoryIcon.js";
import { Spinner } from "../components/Spinner.js";
import { HelpFormSheet } from "../components/HelpFormSheet.js";
import { ImageLightbox } from "../components/ImageLightbox.js";
import { HelpDetailSheet } from "../components/HelpDetailSheet.js";
import { useAuthStore } from "../store/auth.js";
import { useUIStore } from "../store/ui.js";
import { useSocketEvent } from "../hooks/useSocket.js";
import { useGeolocation } from "../hooks/useGeolocation.js";
import { haversineMeters, formatDistance } from "../utils/distance.js";

type Tab = "need" | "offer";

type Urgency = "" | "critical" | "urgent" | "normal";

export function HelpPage() {
  const [tab, setTab] = useState<Tab>("need");
  const [category, setCategory] = useState<string>("");
  const [urgency, setUrgency] = useState<Urgency>("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<HelpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [otherTabTotal, setOtherTabTotal] = useState(0);
  const [urgencyCounts, setUrgencyCounts] = useState({ critical: 0, urgent: 0, normal: 0 });
  const [showForm, setShowForm] = useState(false);
  const [detailItem, setDetailItem] = useState<HelpRequest | null>(null);
  const loadingMore = useRef(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const user = useAuthStore((s) => s.user);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn());
  const showToast = useUIStore((s) => s.showToast);
  const { position, requestPosition } = useGeolocation();

  useEffect(() => {
    requestPosition();
  }, [requestPosition]);

  // Debounce search
  useEffect(() => {
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  const fetchItems = useCallback(
    async (pageNum: number, append = false) => {
      if (!append) setLoading(true);
      try {
        const params: Record<string, string | number> = {
          type: tab,
          status: "open",
          limit: 20,
          page: pageNum,
          sort: "created_at",
          order: "desc",
        };
        if (category) params.category = category;
        if (urgency) params.urgency = urgency;

        const res = await getHelpRequests(params);
        const data = (res.data ?? []) as HelpRequest[];

        if (append) {
          setItems((prev) => [...prev, ...data]);
        } else {
          setItems(data);
        }
        setTotal(res.meta?.total ?? 0);
      } catch {
        showToast("Не удалось загрузить данные", "error");
      } finally {
        setLoading(false);
        loadingMore.current = false;
      }
    },
    [tab, category, urgency, showToast],
  );

  // Counts are computed ignoring the urgency filter so the summary strip
  // stays informative while the list narrows.
  const fetchCounts = useCallback(async () => {
    const otherTab = tab === "need" ? "offer" : "need";
    const base: Record<string, string | number> = {
      status: "open",
      limit: 1,
      page: 1,
    };
    if (category) base.category = category;

    const safe = async (params: Record<string, string | number>): Promise<number> => {
      try {
        const r = await getHelpRequests(params);
        return r.meta?.total ?? 0;
      } catch {
        return 0;
      }
    };

    const [other, critical, urgent, normal] = await Promise.all([
      safe({ ...base, type: otherTab }),
      safe({ ...base, type: tab, urgency: "critical" }),
      safe({ ...base, type: tab, urgency: "urgent" }),
      safe({ ...base, type: tab, urgency: "normal" }),
    ]);
    setOtherTabTotal(other);
    setUrgencyCounts({ critical, urgent, normal });
  }, [tab, category]);

  useEffect(() => {
    setPage(1);
    fetchItems(1);
  }, [fetchItems]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  useEffect(() => {
    const el = document.getElementById("app-main");
    const scrollEl = el?.querySelector(".tab-alive--visible") ?? document.documentElement;
    const handleScroll = () => {
      if (loadingMore.current) return;
      const target = scrollEl === document.documentElement ? scrollEl : scrollEl as HTMLElement;
      const { scrollTop, scrollHeight, clientHeight } = target;
      if (scrollTop + clientHeight >= scrollHeight - 200 && items.length < total) {
        loadingMore.current = true;
        const nextPage = page + 1;
        setPage(nextPage);
        fetchItems(nextPage, true);
      }
    };
    const target = scrollEl === document.documentElement ? window : scrollEl;
    target.addEventListener("scroll", handleScroll, { passive: true });
    return () => target.removeEventListener("scroll", handleScroll);
  }, [items.length, total, page, fetchItems]);

  useSocketEvent("help_request:created", (hr) => {
    if (hr.type === tab && (!category || hr.category === category)) {
      setItems((prev) => [hr, ...prev]);
      setTotal((t) => t + 1);
    }
  });
  useSocketEvent("help_request:updated", (hr) => {
    setItems((prev) => prev.map((h) => (h.id === hr.id ? hr : h)));
    setDetailItem((prev) => (prev && prev.id === hr.id ? hr : prev));
  });
  useSocketEvent("help_request:claimed", (hr) => {
    setItems((prev) => prev.map((h) => (h.id === hr.id ? hr : h)));
    setDetailItem((prev) => (prev && prev.id === hr.id ? hr : prev));
  });
  // When someone else responds or changes their response state, refetch just
  // this row so our responses[] and derived status update without a full reload.
  useSocketEvent("help_response:changed", async (payload) => {
    try {
      const { getHelpRequest } = await import("../services/api.js");
      const res = await getHelpRequest(payload.helpRequestId);
      const hr = (res as { data?: HelpRequest }).data;
      if (hr) {
        setItems((prev) => prev.map((h) => (h.id === hr.id ? hr : h)));
        setDetailItem((prev) => (prev && prev.id === hr.id ? hr : prev));
      }
    } catch {
      // Silent — the next list refresh will resync.
    }
  });

  const handleClaim = async (id: string) => {
    if (!isLoggedIn) {
      showToast("Войдите, чтобы откликнуться", "error");
      return;
    }
    try {
      const res = await respondToHelpRequest(id);
      const updated = res.data as HelpRequest | undefined;
      if (updated) {
        setItems((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
        // Open (or refresh) the detail sheet on the claimed row so the
        // volunteer lands on the "you responded — now call them" screen
        // instead of being dumped back to the list with just a toast.
        setDetailItem(updated);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Ошибка", "error");
    }
  };

  const handleResponseStatus = async (id: string, status: HelpResponseStatus) => {
    try {
      const res = status === "cancelled"
        ? await cancelMyHelpResponse(id)
        : await updateMyHelpResponse(id, status);
      const updated = (res as { data?: HelpRequest }).data;
      if (updated && typeof updated === "object" && "id" in updated) {
        setItems((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
        setDetailItem(updated);
      } else if (status === "cancelled") {
        // DELETE returns { id, cancelled:true } — just refresh the row.
        handleRefresh();
        setDetailItem(null);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Ошибка", "error");
    }
  };

  const handleRefresh = () => {
    setPage(1);
    fetchItems(1);
  };

  // Client-side search filtering
  const filtered = useMemo(() => {
    if (!debouncedSearch) return items;
    const q = debouncedSearch.toLowerCase();
    return items.filter(
      (hr) =>
        (hr.description ?? "").toLowerCase().includes(q) ||
        (hr.address ?? "").toLowerCase().includes(q),
    );
  }, [items, debouncedSearch]);

  // Split into: (1) requests I'm actively responding to, (2) my own requests,
  // (3) everything else. "Мои отклики" is pinned to the top so a volunteer
  // never has to hunt for the conversation they started.
  const isActiveResponse = (status: string | null | undefined) =>
    !!status && status !== "cancelled" && status !== "helped";

  const myResponseItems = useMemo(
    () => (user
      ? filtered
          .filter((hr) => hr.userId !== user.id && isActiveResponse(hr.myResponseStatus))
          // Most recently active first — newest message or update wins.
          .sort((a, b) => {
            const at = a.lastMessageAt ?? a.updatedAt;
            const bt = b.lastMessageAt ?? b.updatedAt;
            return bt.localeCompare(at);
          })
      : []),
    [filtered, user],
  );
  const myResponseIds = useMemo(
    () => new Set(myResponseItems.map((hr) => hr.id)),
    [myResponseItems],
  );
  const myItems = useMemo(
    () => (user ? filtered.filter((hr) => hr.userId === user.id) : []),
    [filtered, user],
  );
  const otherItems = useMemo(
    () => (user
      ? filtered.filter((hr) => hr.userId !== user.id && !myResponseIds.has(hr.id))
      : filtered),
    [filtered, user, myResponseIds],
  );
  const totalUnread = useMemo(
    () => myResponseItems.reduce((a, hr) => a + (hr.unreadMessages ?? 0), 0),
    [myResponseItems],
  );

  const currentTabTotal = urgencyCounts.critical + urgencyCounts.urgent + urgencyCounts.normal;
  const needCount = tab === "need" ? currentTabTotal : otherTabTotal;
  const offerCount = tab === "offer" ? currentTabTotal : otherTabTotal;

  const toggleUrgency = (u: Urgency) => setUrgency(urgency === u ? "" : u);

  return (
    <div className="help-page">
      <div className="help-tabs">
        <button
          className={`help-tab ${tab === "need" ? "help-tab--active" : ""}`}
          onClick={() => setTab("need")}
        >
          Нужна помощь
          {needCount > 0 && <span className="help-tab-count">{needCount}</span>}
        </button>
        <button
          className={`help-tab ${tab === "offer" ? "help-tab--active" : ""}`}
          onClick={() => setTab("offer")}
        >
          Могу помочь
          {offerCount > 0 && <span className="help-tab-count">{offerCount}</span>}
        </button>
      </div>

      {/* Search bar */}
      <div className="help-search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="search"
          placeholder="Поиск по описанию..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="help-search-clear" onClick={() => setSearch("")}>
            ✕
          </button>
        )}
      </div>

      <div className="chip-row">
        <CategoryChip label="Все" active={!category} onClick={() => setCategory("")} />
        {HELP_CATEGORIES.map((cat) => (
          <CategoryChip
            key={cat}
            label={HELP_CATEGORY_LABELS[cat]}
            active={category === cat}
            onClick={() => setCategory(category === cat ? "" : cat)}
          />
        ))}
      </div>

      {currentTabTotal > 0 && (
        <div className="help-summary" role="group" aria-label="Фильтр по срочности">
          {urgencyCounts.critical > 0 && (
            <button
              type="button"
              className={`help-summary-item help-summary-item--critical ${urgency === "critical" ? "is-active" : ""}`}
              onClick={() => toggleUrgency("critical")}
              aria-pressed={urgency === "critical"}
            >
              <span className="help-summary-count">{urgencyCounts.critical}</span>
              <span className="help-summary-label">критич.</span>
            </button>
          )}
          {urgencyCounts.urgent > 0 && (
            <button
              type="button"
              className={`help-summary-item help-summary-item--urgent ${urgency === "urgent" ? "is-active" : ""}`}
              onClick={() => toggleUrgency("urgent")}
              aria-pressed={urgency === "urgent"}
            >
              <span className="help-summary-count">{urgencyCounts.urgent}</span>
              <span className="help-summary-label">срочн.</span>
            </button>
          )}
          {urgencyCounts.normal > 0 && (
            <button
              type="button"
              className={`help-summary-item help-summary-item--normal ${urgency === "normal" ? "is-active" : ""}`}
              onClick={() => toggleUrgency("normal")}
              aria-pressed={urgency === "normal"}
            >
              <span className="help-summary-count">{urgencyCounts.normal}</span>
              <span className="help-summary-label">обычн.</span>
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="help-list">
          {[0, 1, 2].map((i) => (
            <div key={i} className="help-card help-card-skeleton">
              <div className="skel skel-hero" />
              <div className="skel skel-line skel-line--w60" />
              <div className="skel skel-line skel-line--w80" />
              <div className="skel skel-line skel-line--w40" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state-enhanced">
          <svg className="empty-state-icon" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
            <rect x="9" y="3" width="6" height="4" rx="1" />
            <path d="M9 14l2 2 4-4" />
          </svg>
          <p className="empty-state-title">
            {debouncedSearch
              ? "Ничего не найдено"
              : tab === "need"
                ? "Заявок пока нет"
                : "Предложений пока нет"}
          </p>
          <p className="empty-state-subtitle">
            {debouncedSearch ? "Попробуйте другой запрос" : "Нажмите + чтобы создать первую"}
          </p>
        </div>
      ) : (
        <div className="help-list">
          {/* Active responses — the requests you're currently helping with.
              Pinned to the top so you never lose track of a conversation. */}
          {myResponseItems.length > 0 && (
            <>
              <div className="help-my-header help-my-header--responses">
                Мои отклики ({myResponseItems.length})
                {totalUnread > 0 && (
                  <span className="help-my-unread">{totalUnread} новых</span>
                )}
              </div>
              {myResponseItems.map((hr, i) => (
                <HelpCard
                  key={hr.id}
                  item={hr}
                  isNeed={tab === "need"}
                  index={i}
                  userPos={position}
                  currentUserId={user?.id ?? null}
                  onClaim={handleClaim}
                  onDetail={setDetailItem}
                />
              ))}
              {(myItems.length > 0 || otherItems.length > 0) && (
                <div className="help-section-divider" />
              )}
            </>
          )}

          {/* My requests section */}
          {myItems.length > 0 && (
            <>
              <div className="help-my-header">Ваши заявки ({myItems.length})</div>
              {myItems.map((hr, i) => (
                <HelpCard
                  key={hr.id}
                  item={hr}
                  isNeed={tab === "need"}
                  isMine
                  index={myResponseItems.length + i}
                  userPos={position}
                  currentUserId={user?.id ?? null}
                  onClaim={handleClaim}
                  onDetail={setDetailItem}
                />
              ))}
              {otherItems.length > 0 && (
                <div className="help-section-divider" />
              )}
            </>
          )}

          {/* Other requests */}
          {otherItems.map((hr, i) => (
            <HelpCard
              key={hr.id}
              item={hr}
              isNeed={tab === "need"}
              index={myResponseItems.length + myItems.length + i}
              userPos={position}
              currentUserId={user?.id ?? null}
              onClaim={handleClaim}
              onDetail={setDetailItem}
            />
          ))}
          {items.length < total && (
            <div style={{ padding: 16, textAlign: "center" }}>
              <Spinner size={24} />
            </div>
          )}
        </div>
      )}

      <button className="fab" onClick={() => setShowForm(true)} aria-label="Оставить заявку">
        <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Создать
      </button>

      {showForm && <HelpFormSheet tab={tab} onClose={() => { setShowForm(false); handleRefresh(); window.scrollTo({ top: 0, behavior: "smooth" }); }} />}

      {detailItem && (
        <HelpDetailSheet
          item={detailItem}
          isNeed={tab === "need"}
          currentUserId={user?.id ?? null}
          onClaim={handleClaim}
          onUpdateResponse={handleResponseStatus}
          onClose={() => setDetailItem(null)}
        />
      )}
    </div>
  );
}

function HelpCard({
  item,
  isNeed,
  isMine,
  index,
  userPos,
  currentUserId,
  onClaim,
  onDetail,
}: {
  item: HelpRequest;
  isNeed: boolean;
  isMine?: boolean;
  index: number;
  userPos: { lat: number; lng: number } | null;
  currentUserId: string | null;
  onClaim: (id: string) => void;
  onDetail: (item: HelpRequest) => void;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const photos = item.photoUrls ?? [];
  const animDelay = index < 10 ? index * 50 : 0;

  const distance = useMemo(() => {
    if (!userPos || item.lat == null || item.lng == null) return null;
    return haversineMeters(userPos.lat, userPos.lng, item.lat, item.lng);
  }, [userPos, item.lat, item.lng]);

  const isActiveMyResponse =
    !!item.myResponseStatus &&
    item.myResponseStatus !== "cancelled" &&
    item.myResponseStatus !== "helped";
  const unread = item.unreadMessages ?? 0;

  return (
    <div
      className={`help-card ${isMine ? "help-card--mine" : ""} ${isActiveMyResponse ? "help-card--responding" : ""}`}
      data-urgency={item.urgency}
      style={animDelay ? { "--anim-delay": `${animDelay}ms` } as CSSProperties : undefined}
    >
      {/* Response badge — pinned strip at the top of cards where I'm actively
          helping. Tappable through to the detail sheet (parent onClick). */}
      {isActiveMyResponse && (
        <div className="help-card-response-strip">
          <span className="help-card-response-state">
            {item.myResponseStatus === "responded" && "Вы откликнулись"}
            {item.myResponseStatus === "on_way" && "Вы в пути"}
            {item.myResponseStatus === "arrived" && "Вы на месте"}
          </span>
          {unread > 0 && (
            <span className="help-card-unread">
              {unread} {unread === 1 ? "новое" : "новых"}
            </span>
          )}
        </div>
      )}
      {photos.length > 0 && (
        <div className="help-card-hero" onClick={() => setLightboxIndex(0)}>
          <img src={photos[0]} alt="" loading={index < 3 ? "eager" : "lazy"} />
          {photos.length > 1 && (
            <span className="help-card-hero-count">+{photos.length - 1}</span>
          )}
        </div>
      )}
      <div className="help-card-body" onClick={() => onDetail(item)}>
        <div className="help-card-header">
          <span className="help-card-icon" data-category={item.category} data-urgency={item.urgency}>
            <CategoryIcon category={item.category} size={20} />
          </span>
          <span className="help-card-category">{HELP_CATEGORY_LABELS[item.category]}</span>
          {item.urgency === "critical" ? (
            <span className="help-card-critical-label" role="status">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              КРИТИЧНО
            </span>
          ) : (
            <UrgencyBadge value={item.urgency} kind="urgency" />
          )}
        </div>
        {item.description && <p className="help-card-desc">{item.description}</p>}
        <div className="help-card-meta">
          {item.address && (
            <span className="help-card-address" title={item.address}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <span className="help-card-address-text">{item.address}</span>
            </span>
          )}
          {distance != null && (
            <span className="help-card-distance" title="Расстояние от вас">
              {formatDistance(distance)}
            </span>
          )}
          <span
            className="help-card-time"
            title={new Date(item.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          >
            {formatRelativeTime(item.createdAt)}
          </span>
        </div>
      </div>
      <div className="help-card-actions">
        {(() => {
          const responses = item.responses ?? [];
          const activeResponses = responses.filter((r) => r.status !== "cancelled");
          const myResponse = currentUserId
            ? responses.find((r) => r.userId === currentUserId && r.status !== "cancelled")
            : null;
          // Response count hint — encourages coordination ("3 already responded, I'll pick another")
          const responseCountLabel = activeResponses.length > 0
            ? `${activeResponses.length} ${activeResponses.length === 1 ? "отклик" : "отклика"}`
            : null;
          const showRespond = isNeed && !myResponse && item.status !== "completed" && item.status !== "cancelled";
          const phone = item.contactPhone ?? item.author?.phone ?? null;

          return (
            <>
              {showRespond && (
                <button className="btn btn-primary btn-sm" onClick={() => onClaim(item.id)}>
                  Откликнуться
                </button>
              )}
              {phone && (
                <a href={`tel:${phone}`} className="help-card-phone" aria-label="Позвонить">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                </a>
              )}
              {responseCountLabel && item.status !== "open" && (
                <span className="help-card-status">
                  {HELP_REQUEST_STATUS_LABELS[item.status]} · {responseCountLabel}
                </span>
              )}
              {responseCountLabel && item.status === "open" && (
                <span className="help-card-status help-card-status--soft">
                  {responseCountLabel}
                </span>
              )}
            </>
          );
        })()}
      </div>
      {lightboxIndex !== null && (
        <ImageLightbox
          urls={photos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
