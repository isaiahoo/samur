// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useCallback, useRef } from "react";
import type { HelpRequest, HelpCategory } from "@samur/shared";
import {
  HELP_CATEGORY_LABELS,
  URGENCY_LABELS,
  HELP_REQUEST_STATUS_LABELS,
  HELP_CATEGORIES,
} from "@samur/shared";
import { formatRelativeTime } from "@samur/shared";
import { getHelpRequests, updateHelpRequest, createHelpRequest } from "../services/api.js";
import { UrgencyBadge } from "../components/UrgencyBadge.js";
import { CategoryChip } from "../components/CategoryChip.js";
import { Spinner } from "../components/Spinner.js";
import { useAuthStore } from "../store/auth.js";
import { useUIStore } from "../store/ui.js";
import { useSocketEvent } from "../hooks/useSocket.js";

type Tab = "need" | "offer";

export function HelpPage() {
  const [tab, setTab] = useState<Tab>("need");
  const [category, setCategory] = useState<string>("");
  const [items, setItems] = useState<HelpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const loadingMore = useRef(false);

  const isLoggedIn = useAuthStore((s) => s.isLoggedIn());
  const showToast = useUIStore((s) => s.showToast);

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
    const handleScroll = () => {
      if (loadingMore.current) return;
      const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
      if (scrollTop + clientHeight >= scrollHeight - 200 && items.length < total) {
        loadingMore.current = true;
        const nextPage = page + 1;
        setPage(nextPage);
        fetchItems(nextPage, true);
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
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
        <Spinner />
      ) : items.length === 0 ? (
        <div className="empty-state">
          <p>Нет заявок</p>
        </div>
      ) : (
        <div className="help-list">
          {items.map((hr) => (
            <HelpCard
              key={hr.id}
              item={hr}
              isNeed={tab === "need"}
              onClaim={handleClaim}
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
        <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {showForm && <HelpFormModal tab={tab} onClose={() => { setShowForm(false); handleRefresh(); }} />}
    </div>
  );
}

function HelpCard({
  item,
  isNeed,
  onClaim,
}: {
  item: HelpRequest;
  isNeed: boolean;
  onClaim: (id: string) => void;
}) {
  const categoryIcons: Record<string, string> = {
    rescue: "🆘", shelter: "🏠", food: "🍞", water: "💧",
    medicine: "💊", equipment: "🔧", transport: "🚗", labor: "💪",
    generator: "⚡", pump: "🔄",
  };

  return (
    <div className="help-card">
      <div className="help-card-header">
        <span className="help-card-icon">{categoryIcons[item.category] ?? "📋"}</span>
        <span className="help-card-category">{HELP_CATEGORY_LABELS[item.category]}</span>
        <UrgencyBadge value={item.urgency} kind="urgency" />
      </div>
      {item.description && <p className="help-card-desc">{item.description}</p>}
      <div className="help-card-meta">
        {item.address && <span>{item.address}</span>}
        <span>{formatRelativeTime(item.createdAt)}</span>
      </div>
      {item.contactName && (
        <p className="help-card-contact">{item.contactName}</p>
      )}
      <div className="help-card-actions">
        {isNeed && item.status === "open" && (
          <button className="btn btn-primary btn-sm" onClick={() => onClaim(item.id)}>
            Откликнуться
          </button>
        )}
        {item.contactPhone && (
          <a href={`tel:${item.contactPhone}`} className="btn btn-secondary btn-sm">
            Позвонить
          </a>
        )}
        {item.status !== "open" && (
          <span className="help-card-status">{HELP_REQUEST_STATUS_LABELS[item.status]}</span>
        )}
      </div>
    </div>
  );
}

function HelpFormModal({ tab, onClose }: { tab: Tab; onClose: () => void }) {
  const [category, setCategory] = useState<HelpCategory>("rescue");
  const [description, setDescription] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [urgency, setUrgency] = useState("normal");
  const [submitting, setSubmitting] = useState(false);

  const user = useAuthStore((s) => s.user);
  const showToast = useUIStore((s) => s.showToast);

  useEffect(() => {
    if (user) {
      setContactName(user.name ?? "");
      setContactPhone(user.phone ?? "");
    }
  }, [user]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // Use Makhachkala center as default if no geolocation
      await createHelpRequest({
        type: tab === "offer" ? "offer" : "need",
        category,
        description: description || undefined,
        lat: 42.9849,
        lng: 47.5047,
        urgency,
        contactName: contactName || undefined,
        contactPhone: contactPhone || undefined,
        source: "pwa",
      });
      showToast("Заявка создана", "success");
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Ошибка", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{tab === "offer" ? "Предложить помощь" : "Запросить помощь"}</h3>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <div className="form-group">
          <label>Категория</label>
          <select className="form-input" value={category} onChange={(e) => setCategory(e.target.value as HelpCategory)}>
            {HELP_CATEGORIES.map((c) => (
              <option key={c} value={c}>{HELP_CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Срочность</label>
          <select className="form-input" value={urgency} onChange={(e) => setUrgency(e.target.value)}>
            <option value="normal">Обычная</option>
            <option value="urgent">Срочная</option>
            <option value="critical">Критическая</option>
          </select>
        </div>

        <div className="form-group">
          <label>Описание</label>
          <textarea
            className="form-input"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Опишите, что нужно..."
          />
        </div>

        <div className="form-group">
          <label>Имя</label>
          <input className="form-input" value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </div>

        <div className="form-group">
          <label>Телефон</label>
          <input className="form-input" type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+79001234567" />
        </div>

        <button className="btn btn-primary btn-lg" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Отправка..." : "Отправить"}
        </button>
      </div>
    </div>
  );
}
