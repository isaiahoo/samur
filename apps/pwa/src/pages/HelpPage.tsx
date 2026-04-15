// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useCallback, useRef, useMemo, type CSSProperties } from "react";
import type { HelpRequest } from "@samur/shared";
import {
  HELP_CATEGORY_LABELS,
  HELP_REQUEST_STATUS_LABELS,
  HELP_CATEGORIES,
} from "@samur/shared";
import { formatRelativeTime } from "@samur/shared";
import { getHelpRequests, updateHelpRequest } from "../services/api.js";
import { UrgencyBadge } from "../components/UrgencyBadge.js";
import { CategoryChip } from "../components/CategoryChip.js";
import { Spinner } from "../components/Spinner.js";
import { HelpFormSheet } from "../components/HelpFormSheet.js";
import { ImageLightbox } from "../components/ImageLightbox.js";
import { HelpDetailSheet } from "../components/HelpDetailSheet.js";
import { useAuthStore } from "../store/auth.js";
import { useUIStore } from "../store/ui.js";
import { useSocketEvent } from "../hooks/useSocket.js";

type Tab = "need" | "offer";

export function HelpPage() {
  const [tab, setTab] = useState<Tab>("need");
  const [category, setCategory] = useState<string>("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<HelpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [detailItem, setDetailItem] = useState<HelpRequest | null>(null);
  const loadingMore = useRef(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const user = useAuthStore((s) => s.user);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn());
  const showToast = useUIStore((s) => s.showToast);

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
    [tab, category, showToast],
  );

  useEffect(() => {
    setPage(1);
    fetchItems(1);
  }, [fetchItems]);

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
  });
  useSocketEvent("help_request:claimed", (hr) => {
    setItems((prev) => prev.map((h) => (h.id === hr.id ? hr : h)));
  });

  const handleClaim = async (id: string) => {
    if (!isLoggedIn) {
      showToast("Войдите, чтобы откликнуться", "error");
      return;
    }
    try {
      await updateHelpRequest(id, { status: "claimed" });
      showToast("Вы откликнулись на заявку", "success");
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

  // Split into my items and others
  const myItems = useMemo(
    () => (user ? filtered.filter((hr) => hr.userId === user.id) : []),
    [filtered, user],
  );
  const otherItems = useMemo(
    () => (user ? filtered.filter((hr) => hr.userId !== user.id) : filtered),
    [filtered, user],
  );

  return (
    <div className="help-page">
      <div className="help-tabs">
        <button
          className={`help-tab ${tab === "need" ? "help-tab--active" : ""}`}
          onClick={() => setTab("need")}
        >
          Нужна помощь
        </button>
        <button
          className={`help-tab ${tab === "offer" ? "help-tab--active" : ""}`}
          onClick={() => setTab("offer")}
        >
          Могу помочь
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
                  index={i}
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
              index={myItems.length + i}
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
          onClaim={handleClaim}
          onClose={() => setDetailItem(null)}
        />
      )}
    </div>
  );
}

const categoryIcons: Record<string, string> = {
  rescue: "🆘", shelter: "🏠", food: "🍞", water: "💧",
  medicine: "💊", equipment: "🔧", transport: "🚗", labor: "💪",
  generator: "⚡", pump: "🔄",
};

function HelpCard({
  item,
  isNeed,
  isMine,
  index,
  onClaim,
  onDetail,
}: {
  item: HelpRequest;
  isNeed: boolean;
  isMine?: boolean;
  index: number;
  onClaim: (id: string) => void;
  onDetail: (item: HelpRequest) => void;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const photos = item.photoUrls ?? [];
  const animDelay = index < 10 ? index * 50 : 0;

  return (
    <div
      className={`help-card ${isMine ? "help-card--mine" : ""}`}
      data-urgency={item.urgency}
      style={animDelay ? { "--anim-delay": `${animDelay}ms` } as CSSProperties : undefined}
    >
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
          <span className="help-card-icon">{categoryIcons[item.category] ?? "📋"}</span>
          <span className="help-card-category">{HELP_CATEGORY_LABELS[item.category]}</span>
          <UrgencyBadge value={item.urgency} kind="urgency" />
        </div>
        {item.description && <p className="help-card-desc">{item.description}</p>}
        <div className="help-card-meta">
          {item.address && (
            <span className="help-card-address">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              {item.address}
            </span>
          )}
          <span>
            {formatRelativeTime(item.createdAt)}
            {" · "}
            {new Date(item.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </div>
      <div className="help-card-actions">
        {isNeed && item.status === "open" && (
          <button className="btn btn-primary btn-sm" onClick={() => onClaim(item.id)}>
            Откликнуться
          </button>
        )}
        {item.contactPhone && (
          <a href={`tel:${item.contactPhone}`} className="help-card-phone" aria-label="Позвонить">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          </a>
        )}
        {item.status !== "open" && (
          <span className="help-card-status">{HELP_REQUEST_STATUS_LABELS[item.status]}</span>
        )}
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
