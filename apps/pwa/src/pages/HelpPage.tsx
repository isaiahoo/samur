// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useCallback, useRef, useMemo, type CSSProperties } from "react";
import type { HelpRequest } from "@samur/shared";
import {
  HELP_CATEGORY_LABELS,
  HELP_REQUEST_STATUS_LABELS,
  HELP_CATEGORIES,
} from "@samur/shared";
import { formatRelativeTime } from "@samur/shared";
import { useLocation, useNavigate } from "react-router-dom";
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
  const location = useLocation();
  const navigate = useNavigate();

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
        const params: Record<string, string | number | boolean> = {
          type: tab,
          // Show everything that's still in flight — open, claimed, in_progress.
          // A stricter status=open hid the author's own request as soon as
          // someone responded, which made it look deleted.
          activeOnly: true,
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
  // stays informative while the list narrows. Uses activeOnly to match the
  // main list — otherwise "Всего 0" while a claimed request sits in view.
  const fetchCounts = useCallback(async () => {
    const otherTab = tab === "need" ? "offer" : "need";
    const base: Record<string, string | number | boolean> = {
      activeOnly: true,
      limit: 1,
      page: 1,
    };
    if (category) base.category = category;

    const safe = async (
      params: Record<string, string | number | boolean>,
    ): Promise<number> => {
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

  // Deep-link support: scroll to the zone anchor when the URL hash matches
  // (profile menu's "Мои отклики" / "Мои заявки" rows land the user on the
  // matching section). Clear the hash after scrolling so a later list
  // refresh (cancel → handleRefresh flips loading) doesn't yank the user
  // back to the anchor mid-interaction.
  useEffect(() => {
    if (!location.hash || loading) return;
    const id = location.hash.slice(1);
    const el = document.getElementById(id);
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      navigate(location.pathname + location.search, { replace: true });
    });
  }, [location.hash, loading, location.pathname, location.search, navigate]);

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
      if (status === "cancelled") {
        // DELETE /my-response returns { id: responseId, cancelled: true } —
        // a confirmation blob, not a HelpRequest. Handle it by refreshing
        // the list so the row drops out of "Ваши отклики" cleanly.
        await cancelMyHelpResponse(id);
        setDetailItem(null);
        handleRefresh();
        return;
      }
      const res = await updateMyHelpResponse(id, status);
      const updated = (res as { data?: HelpRequest }).data;
      if (updated && typeof updated === "object" && "id" in updated) {
        setItems((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
        setDetailItem(updated);
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
          {/* Active responses — commitments the volunteer has made. Pinned
              to the top with its own muted-zone styling so it reads as a
              task list, not just another row of cards. */}
          {myResponseItems.length > 0 && (
            <section id="zone-commitments" className="help-zone help-zone--commitments" aria-label="Ваши отклики">
              <div className="help-zone-header">
                <span className="help-zone-title">Ваши отклики</span>
                <span className="help-zone-count">{myResponseItems.length}</span>
                {totalUnread > 0 && (
                  <span className="help-zone-unread">{totalUnread} новых</span>
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
                  onUpdateResponseStatus={handleResponseStatus}
                  onDetail={setDetailItem}
                />
              ))}
            </section>
          )}

          {/* Author's own requests — separate zone so the requester can
              track who's responded to each. Откликнуться CTA is hidden on
              own requests (the old code left it visible — a bug). */}
          {myItems.length > 0 && (
            <section id="zone-own" className="help-zone help-zone--own" aria-label="Ваши заявки">
              <div className="help-zone-header">
                <span className="help-zone-title">Ваши заявки</span>
                <span className="help-zone-count">{myItems.length}</span>
              </div>
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
                  onUpdateResponseStatus={handleResponseStatus}
                  onDetail={setDetailItem}
                />
              ))}
            </section>
          )}

          {/* Discovery — requests from others that the viewer hasn't
              responded to. Always present as an explicit zone so new
              requests have a dedicated home, not "whatever's left". */}
          <section className="help-zone help-zone--discovery" aria-label="Нужна помощь рядом">
            <div className="help-zone-header">
              <span className="help-zone-title">
                {tab === "need" ? "Нужна помощь рядом" : "Предложения помощи"}
              </span>
              <span className="help-zone-count">{otherItems.length}</span>
            </div>
            {otherItems.length === 0 ? (
              <p className="help-zone-empty">
                {tab === "need"
                  ? "Сейчас нет открытых заявок рядом. Новые появятся здесь автоматически."
                  : "Новых предложений нет."}
              </p>
            ) : (
              otherItems.map((hr, i) => (
                <HelpCard
                  key={hr.id}
                  item={hr}
                  isNeed={tab === "need"}
                  index={myResponseItems.length + myItems.length + i}
                  userPos={position}
                  currentUserId={user?.id ?? null}
                  onClaim={handleClaim}
                  onUpdateResponseStatus={handleResponseStatus}
                  onDetail={setDetailItem}
                />
              ))
            )}
          </section>
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

/** Age-bucket for a response's last status change. Drives the pulse
 * intensity on the current progress dot + the tone of the inline note.
 * Thresholds match the Phase-3 reaper (auto-cancels at 6 h). */
type ResponseAge = "fresh" | "due" | "stale";
function ageBucket(updatedAt: string | null | undefined, status: string | null | undefined): ResponseAge {
  if (!updatedAt || status !== "responded") return "fresh";
  const mins = (Date.now() - new Date(updatedAt).getTime()) / 60_000;
  if (mins > 360) return "stale";  // 6 h+
  if (mins > 120) return "due";    // 2–6 h
  return "fresh";
}

function formatAgeShort(updatedAt: string | null | undefined): string | null {
  if (!updatedAt) return null;
  const mins = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60_000);
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч`;
  return `${Math.floor(hours / 24)} д`;
}

/** Four-step commitment lifecycle visualized as dots + connectors. The
 * current dot pulses when the response ages past its threshold so the
 * signal reaches peripheral vision without tinting the whole card. */
const STATUS_STEPS: Array<{ key: HelpResponseStatus; label: string }> = [
  { key: "responded", label: "откликнулись" },
  { key: "on_way", label: "в пути" },
  { key: "arrived", label: "на месте" },
  { key: "helped", label: "помогли" },
];

function nextActionLabel(status: HelpResponseStatus | null | undefined): { label: string; target: HelpResponseStatus } | null {
  if (status === "responded") return { label: "Я в пути", target: "on_way" };
  if (status === "on_way") return { label: "На месте", target: "arrived" };
  if (status === "arrived") return { label: "Помог", target: "helped" };
  return null;
}

function ResponseProgress({
  status,
  age,
}: {
  status: HelpResponseStatus;
  age: ResponseAge;
}) {
  const currentIdx = STATUS_STEPS.findIndex((s) => s.key === status);
  const currentLabel = STATUS_STEPS[currentIdx]?.label;
  return (
    <div className="rp-track" role="progressbar" aria-valuemin={0} aria-valuemax={STATUS_STEPS.length - 1} aria-valuenow={currentIdx < 0 ? 0 : currentIdx}>
      <div className="rp-row">
        {STATUS_STEPS.map((s, i) => {
          const done = i < currentIdx;
          const current = i === currentIdx;
          const dotClass = done
            ? "rp-dot rp-dot--done"
            : current
              ? `rp-dot rp-dot--current rp-dot--${age}`
              : "rp-dot";
          return (
            <div key={s.key} className="rp-step">
              <span className={dotClass} aria-hidden="true" />
              {i < STATUS_STEPS.length - 1 && (
                <span className={`rp-line ${done ? "rp-line--done" : ""}`} aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>
      {currentLabel && (
        <div className={`rp-current-label rp-current-label--${age}`}>
          Вы {currentLabel}
        </div>
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
  onUpdateResponseStatus,
  onDetail,
}: {
  item: HelpRequest;
  isNeed: boolean;
  isMine?: boolean;
  index: number;
  userPos: { lat: number; lng: number } | null;
  currentUserId: string | null;
  onClaim: (id: string) => void;
  onUpdateResponseStatus: (id: string, status: HelpResponseStatus) => void;
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
  const age = ageBucket(item.myResponseUpdatedAt, item.myResponseStatus);
  const ageLabel = formatAgeShort(item.myResponseUpdatedAt);

  return (
    <div
      className={`help-card ${isMine ? "help-card--mine" : ""} ${isActiveMyResponse ? "help-card--responding" : ""} help-card--age-${age}`}
      data-urgency={item.urgency}
      style={animDelay ? { "--anim-delay": `${animDelay}ms` } as CSSProperties : undefined}
      // Whole card opens the detail — matches the native list-cell idiom
      // instead of requiring users to find the narrow body strip. Inner
      // interactives (photo, phone, action buttons, commitment footer)
      // stop propagation so they keep their own behaviour.
      role="button"
      tabIndex={0}
      onClick={() => onDetail(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onDetail(item);
        }
      }}
    >
      {/* Unread chip — small, corner-pinned. Replaces the old chunky strip
          for showing "there's a new message in this thread". Age signal
          moved to the progress dots below (no more full-card tint). */}
      {isActiveMyResponse && unread > 0 && (
        <span className="help-card-unread-pill" aria-label={`${unread} новых сообщений`}>
          {unread}
        </span>
      )}
      {photos.length > 0 && (
        <div
          className="help-card-hero"
          onClick={(e) => { e.stopPropagation(); setLightboxIndex(0); }}
        >
          <img src={photos[0]} alt="" loading={index < 3 ? "eager" : "lazy"} />
          {photos.length > 1 && (
            <span className="help-card-hero-count">+{photos.length - 1}</span>
          )}
        </div>
      )}
      <div className="help-card-body">
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
          ) : item.urgency === "urgent" ? (
            <UrgencyBadge value={item.urgency} kind="urgency" />
          ) : null}
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
      {(() => {
        const responses = item.responses ?? [];
        const activeResponses = responses.filter((r) => r.status !== "cancelled");
        const myResponse = currentUserId
          ? responses.find((r) => r.userId === currentUserId && r.status !== "cancelled")
          : null;
        const responseCountLabel = activeResponses.length > 0
          ? `${activeResponses.length} ${activeResponses.length === 1 ? "отклик" : "отклика"}`
          : null;
        const showRespond = isNeed && !isMine && !myResponse && item.status !== "completed" && item.status !== "cancelled";
        const phone = item.contactPhone ?? item.author?.phone ?? null;

        // Active-response cards get the unified commitment footer:
        // progress timeline + dominant primary CTA + overflow menu. Menu
        // state is per-card, so the footer lives in its own component.
        if (isActiveMyResponse && item.myResponseStatus) {
          return (
            <CommitmentFooter
              item={item}
              status={item.myResponseStatus}
              age={age}
              ageLabel={ageLabel}
              phone={phone}
              onUpdateResponseStatus={onUpdateResponseStatus}
            />
          );
        }

        // Discovery / own-request cards: Respond CTA (when applicable)
        // + phone + response count. Unchanged behaviour.
        return (
          <div className="help-card-actions">
            {showRespond && (
              <button
                className="btn btn-primary btn-sm"
                onClick={(e) => { e.stopPropagation(); onClaim(item.id); }}
              >
                Откликнуться
              </button>
            )}
            {phone && (
              <a
                href={`tel:${phone}`}
                className="help-card-phone"
                aria-label="Позвонить"
                onClick={(e) => e.stopPropagation()}
              >
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
          </div>
        );
      })()}
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

/** Footer shown on active-response cards: progress rail + primary CTA +
 * overflow menu. Split out so each card owns its own menu-open state. */
function CommitmentFooter({
  item,
  status,
  age,
  ageLabel,
  phone,
  onUpdateResponseStatus,
}: {
  item: HelpRequest;
  status: HelpResponseStatus;
  age: ResponseAge;
  ageLabel: string | null;
  phone: string | null;
  onUpdateResponseStatus: (id: string, status: HelpResponseStatus) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const next = nextActionLabel(status);

  return (
    <div className="help-card-commitment">
      <ResponseProgress status={status} age={age} />
      {age === "due" && status === "responded" && (
        <p className="help-card-commitment-note">
          Прошло {ageLabel ?? "больше 2 часов"} — подтвердите или отмените.
        </p>
      )}
      {age === "stale" && status === "responded" && (
        <p className="help-card-commitment-note help-card-commitment-note--stale">
          Ещё актуально? Отклик висит {ageLabel}.
        </p>
      )}
      <div className="help-card-commitment-actions">
        {next && (
          <button
            type="button"
            className={`help-card-primary-btn help-card-primary-btn--${age}`}
            onClick={(e) => {
              e.stopPropagation();
              onUpdateResponseStatus(item.id, next.target);
            }}
          >
            {next.label}
            <span className="help-card-primary-arrow" aria-hidden="true">→</span>
          </button>
        )}
        {phone && (
          <a
            href={`tel:${phone}`}
            className="help-card-muted-icon"
            aria-label="Позвонить"
            onClick={(e) => e.stopPropagation()}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          </a>
        )}
        <div className="help-card-menu-wrapper" ref={menuRef}>
          <button
            type="button"
            className="help-card-more-btn"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            aria-label="Ещё"
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>
          {menuOpen && (
            <div className="help-card-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="help-card-menu-item help-card-menu-item--danger"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  if (window.confirm("Отменить ваш отклик? Заявитель увидит, что вы не сможете помочь.")) {
                    onUpdateResponseStatus(item.id, "cancelled");
                  }
                }}
              >
                Отменить отклик
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
