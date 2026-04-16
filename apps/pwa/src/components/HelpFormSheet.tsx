// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useRef, useCallback, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import type { HelpCategory } from "@samur/shared";
import { HELP_CATEGORIES, HELP_CATEGORY_LABELS } from "@samur/shared";
import { createHelpRequest, uploadPhotos } from "../services/api.js";
import { useAuthStore } from "../store/auth.js";
import { useUIStore } from "../store/ui.js";
import { useGeolocation } from "../hooks/useGeolocation.js";
import { compressImage } from "../utils/compressImage.js";
import { CategoryIcon } from "./CategoryIcon.js";

const DESC_MAX = 2000;
const DESC_WARN = 1800; // show counter in red after this

function digitsOnly(phone: string): string {
  return phone.replace(/[\s\-\(\)\+]/g, "");
}
function isValidPhone(phone: string): boolean {
  return digitsOnly(phone).length >= 7;
}

const URGENCY_OPTIONS = [
  { value: "normal",   label: "Обычная",     sub: "в течение дня" },
  { value: "urgent",   label: "Срочная",     sub: "в ближайший час" },
  { value: "critical", label: "Критическая", sub: "нужна помощь сейчас" },
] as const;

function UrgencyIcon({ kind }: { kind: "normal" | "urgent" | "critical" }) {
  const common = {
    width: 14, height: 14, viewBox: "0 0 24 24",
    fill: "none", stroke: "currentColor", strokeWidth: 2,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (kind === "normal") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }
  if (kind === "urgent") {
    return (
      <svg {...common}>
        <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
      </svg>
    );
  }
  return (
    <svg {...common} strokeWidth={2.25}>
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

interface Props {
  tab: "need" | "offer";
  onClose: () => void;
}

export function HelpFormSheet({ tab, onClose }: Props) {
  const [category, setCategory] = useState<HelpCategory | null>(null);
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [editingAddress, setEditingAddress] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [editingContact, setEditingContact] = useState(false);
  const [urgency, setUrgency] = useState("normal");
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [compressing, setCompressing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const user = useAuthStore((s) => s.user);
  const showToast = useUIStore((s) => s.showToast);
  const { position, status: geoStatus, requestPosition } = useGeolocation();
  const reverseGeocodeDone = useRef(false);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Auto-fill from user
  useEffect(() => {
    if (user) {
      setContactName(user.name ?? "");
      setContactPhone(user.phone ?? "");
    }
  }, [user]);

  // Request geolocation on mount
  useEffect(() => {
    requestPosition();
  }, [requestPosition]);

  // Reverse geocode when position arrives
  useEffect(() => {
    if (!position || reverseGeocodeDone.current || address) return;
    reverseGeocodeDone.current = true;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);

    fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${position.lat}&lon=${position.lng}&accept-language=ru&zoom=18`,
      { signal: ctrl.signal },
    )
      .then((r) => r.json())
      .then((data) => {
        const addr = data?.display_name;
        if (addr && typeof addr === "string") {
          const short = addr.split(", ").slice(0, 3).join(", ");
          setAddress(short);
        }
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [position, address]);

  // Clean up preview URLs
  useEffect(() => {
    return () => {
      photoPreviews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [photoPreviews]);

  const addPhotos = useCallback(
    async (selected: File[]) => {
      const MAX_SIZE = 5 * 1024 * 1024;
      for (const f of selected) {
        if (f.size > MAX_SIZE) {
          showToast(`Файл слишком большой (макс. 5 МБ): ${f.name}`, "error");
          return;
        }
      }
      if (selected.length + photos.length > 5) {
        showToast("Максимум 5 фото", "error");
        return;
      }

      setCompressing(true);
      try {
        const compressed = await Promise.all(selected.map((f) => compressImage(f)));
        const newPhotos = [...photos, ...compressed].slice(0, 5);
        setPhotos(newPhotos);
        photoPreviews.forEach((url) => URL.revokeObjectURL(url));
        setPhotoPreviews(newPhotos.map((f) => URL.createObjectURL(f)));
      } finally {
        setCompressing(false);
      }
    },
    [photos, photoPreviews, showToast],
  );

  const handlePhotoSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length) addPhotos(selected);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePhoto = (index: number) => {
    if (photoPreviews[index]) URL.revokeObjectURL(photoPreviews[index]);
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!category) return;
    setSubmitting(true);
    try {
      let photoUrls: string[] | undefined;
      if (photos.length > 0) {
        photoUrls = await uploadPhotos(photos);
      }

      await createHelpRequest({
        type: tab === "offer" ? "offer" : "need",
        category,
        description: description || undefined,
        lat: position?.lat ?? 42.9849,
        lng: position?.lng ?? 47.5047,
        urgency,
        contactName: contactName.trim() || undefined,
        contactPhone: contactPhone.replace(/[\s\-\(\)]/g, "").length >= 7 ? contactPhone.trim() : undefined,
        address: address || undefined,
        photoUrls,
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

  const hasContactInfo = !!(contactName || contactPhone);
  const contactSummary = [contactName, contactPhone].filter(Boolean).join(" \u00B7 ");

  return createPortal(
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet sheet--tall" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-form-header">
          <h3>{tab === "offer" ? "Предложить помощь" : "Запросить помощь"}</h3>
          <button className="btn-close" onClick={onClose} aria-label="Закрыть">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        </div>

        <div className="sheet-form-body">
          {/* Geo indicator — subtle */}
          <div className="geo-indicator">
            <span
              className={`geo-dot ${
                geoStatus === "granted"
                  ? "geo-dot--ok"
                  : geoStatus === "loading"
                    ? "geo-dot--loading"
                    : geoStatus === "denied" || geoStatus === "error"
                      ? "geo-dot--error"
                      : ""
              }`}
            />
            <span className="geo-label">
              {geoStatus === "granted"
                ? "Местоположение определено"
                : geoStatus === "loading"
                  ? "Определяем..."
                  : geoStatus === "denied"
                    ? "Доступ запрещён"
                    : geoStatus === "error"
                      ? "Не удалось определить"
                      : "Ожидание..."}
            </span>
            {(geoStatus === "denied" || geoStatus === "error") && (
              <button className="geo-retry" onClick={requestPosition}>
                Повторить
              </button>
            )}
          </div>

          {/* Category grid (no section label — disabled submit already prompts
              "Выберите категорию") */}
          <div className="category-grid">
            {HELP_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`category-card ${category === cat ? "category-card--selected" : ""}`}
                onClick={() => setCategory(cat)}
              >
                <span className="category-card-icon" data-category={cat}>
                  <CategoryIcon category={cat} size={22} />
                </span>
                <span className="category-card-label">{HELP_CATEGORY_LABELS[cat]}</span>
              </button>
            ))}
          </div>

          {/* Description — friendly, no label */}
          <div className="qf-description-wrap">
            <textarea
              className="qf-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, DESC_MAX))}
              placeholder={tab === "need" ? "Что случилось? Опишите кратко..." : "Чем можете помочь?"}
              maxLength={DESC_MAX}
            />
            {description.length > 0 && (
              <span className={`qf-description-counter${description.length > DESC_WARN ? " qf-description-counter--warn" : ""}`}>
                {description.length} / {DESC_MAX}
              </span>
            )}
          </div>

          {/* Urgency pills */}
          <div className="urgency-pills" role="radiogroup" aria-label="Срочность">
            {URGENCY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={urgency === opt.value}
                className={`urgency-pill ${urgency === opt.value ? `urgency-pill--${opt.value}` : ""}`}
                onClick={() => setUrgency(opt.value)}
              >
                <span className="urgency-pill-main">
                  <UrgencyIcon kind={opt.value} />
                  <span className="urgency-pill-label">{opt.label}</span>
                </span>
                <span className="urgency-pill-sub">{opt.sub}</span>
              </button>
            ))}
          </div>
          {urgency === "critical" && (
            <div className="qf-critical-warning" role="note">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>Используйте только при угрозе жизни или здоровью</span>
            </div>
          )}

          {/* Photo slots — filled previews + one add button (native iOS/Android
              chooser offers camera OR library). No dead empty placeholders. */}
          <div className="photo-slots">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/*"
              multiple
              onChange={handlePhotoSelect}
              style={{ display: "none" }}
            />

            {photoPreviews.map((url, i) => (
              <div key={i} className="photo-slot photo-slot--filled">
                <img src={url} alt="" />
                <button
                  type="button"
                  className="photo-slot-remove"
                  onClick={() => removePhoto(i)}
                  aria-label="Удалить фото"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                    <line x1="6" y1="6" x2="18" y2="18" />
                    <line x1="6" y1="18" x2="18" y2="6" />
                  </svg>
                </button>
              </div>
            ))}

            {photos.length < 5 && (
              <button
                type="button"
                className="photo-slot photo-slot--add"
                onClick={() => fileInputRef.current?.click()}
                disabled={compressing}
                aria-label="Добавить фото"
              >
                <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span className="photo-slot-hint">Фото</span>
              </button>
            )}
          </div>
          {compressing && <div className="qf-hint">Сжатие фото...</div>}

          {/* Address chip */}
          {address && !editingAddress ? (
            <button
              type="button"
              className="qf-chip"
              onClick={() => setEditingAddress(true)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <span className="qf-chip-text">{address}</span>
              <svg className="qf-chip-edit" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
            </button>
          ) : (
            <input
              className="qf-inline-input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Адрес (улица, дом, район)"
              onBlur={() => { if (address) setEditingAddress(false); }}
              autoFocus={editingAddress}
            />
          )}

          {/* Contact summary */}
          {hasContactInfo && !editingContact ? (
            <button
              type="button"
              className="qf-chip"
              onClick={() => setEditingContact(true)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              <span className="qf-chip-text">{contactSummary}</span>
              <svg className="qf-chip-edit" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
            </button>
          ) : (
            <>
              <div className="qf-contact-row">
                <input
                  className="qf-inline-input"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Имя"
                />
                <input
                  className={`qf-inline-input${contactPhone && !isValidPhone(contactPhone) ? " qf-inline-input--error" : ""}`}
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="Телефон"
                  onBlur={() => { if (contactName || contactPhone) setEditingContact(false); }}
                  aria-invalid={contactPhone && !isValidPhone(contactPhone) ? "true" : undefined}
                />
              </div>
              {contactPhone && !isValidPhone(contactPhone) && (
                <div className="qf-field-error">Минимум 7 цифр</div>
              )}
              {!contactName.trim() && !contactPhone.trim() && (
                <div className="qf-hint qf-hint--muted">
                  Без контактов — заявка будет анонимной
                </div>
              )}
            </>
          )}
        </div>

        <div className="sheet-form-footer">
          {(() => {
            const phoneInvalid = !!contactPhone && !isValidPhone(contactPhone);
            const disabled = !category || submitting || phoneInvalid;
            const primary = !!category && !phoneInvalid;
            return (
              <button
                className={`btn btn-lg qf-submit ${primary ? "btn-primary" : ""}`}
                onClick={handleSubmit}
                disabled={disabled}
              >
                {submitting
                  ? photos.length > 0
                    ? "Загрузка фото..."
                    : "Отправляем..."
                  : phoneInvalid
                    ? "Проверьте телефон"
                    : category
                      ? tab === "offer" ? "Предложить помощь" : "Запросить помощь"
                      : "Выберите категорию"}
              </button>
            );
          })()}
        </div>
      </div>
    </div>,
    document.body,
  );
}
