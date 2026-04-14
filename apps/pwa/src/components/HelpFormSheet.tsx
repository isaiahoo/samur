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

const categoryIcons: Record<string, string> = {
  rescue: "🆘", shelter: "🏠", food: "🍞", water: "💧",
  medicine: "💊", equipment: "🔧", transport: "🚗", labor: "💪",
  generator: "⚡", pump: "🔄",
};

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
  const cameraInputRef = useRef<HTMLInputElement>(null);

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

  const handleCameraCapture = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length) addPhotos(selected);
    if (cameraInputRef.current) cameraInputRef.current.value = "";
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
        contactName: contactName || undefined,
        contactPhone: contactPhone || undefined,
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
          <button className="btn-close" onClick={onClose}>✕</button>
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

          {/* Category grid */}
          <div className="qf-section-label">Выберите категорию</div>
          <div className="category-grid">
            {HELP_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`category-card ${category === cat ? "category-card--selected" : ""}`}
                onClick={() => setCategory(cat)}
              >
                <span className="category-card-icon">{categoryIcons[cat] ?? "📋"}</span>
                <span className="category-card-label">{HELP_CATEGORY_LABELS[cat]}</span>
              </button>
            ))}
          </div>

          {/* Description — friendly, no label */}
          <textarea
            className="qf-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={tab === "need" ? "Что случилось? Опишите кратко..." : "Чем можете помочь?"}
          />

          {/* Urgency pills */}
          <div className="urgency-pills">
            {(["normal", "urgent", "critical"] as const).map((u) => (
              <button
                key={u}
                type="button"
                className={`urgency-pill ${urgency === u ? `urgency-pill--${u}` : ""}`}
                onClick={() => setUrgency(u)}
              >
                {u === "urgent" && "⚡ "}
                {u === "critical" && "🔴 "}
                {u === "normal" ? "Обычная" : u === "urgent" ? "Срочная" : "Критическая"}
              </button>
            ))}
          </div>

          {/* Photo slots */}
          <div className="photo-slots">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              multiple
              onChange={handlePhotoSelect}
              style={{ display: "none" }}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleCameraCapture}
              style={{ display: "none" }}
            />

            {photoPreviews.map((url, i) => (
              <div key={i} className="photo-slot photo-slot--filled">
                <img src={url} alt="" />
                <button
                  type="button"
                  className="photo-slot-remove"
                  onClick={() => removePhoto(i)}
                >
                  &times;
                </button>
              </div>
            ))}

            {photos.length < 5 && (
              <button
                type="button"
                className="photo-slot photo-slot--add"
                onClick={() => cameraInputRef.current?.click()}
                disabled={compressing}
              >
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </button>
            )}
            {photos.length < 5 && (
              <button
                type="button"
                className="photo-slot photo-slot--add"
                onClick={() => fileInputRef.current?.click()}
                disabled={compressing}
              >
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
              </button>
            )}

            {/* Empty placeholder slots */}
            {Array.from({ length: Math.max(0, 5 - photos.length - 2) }).map((_, i) => (
              <div key={`empty-${i}`} className="photo-slot photo-slot--empty" />
            ))}
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
              <span className="qf-chip-edit">✏️</span>
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
              <span className="qf-chip-edit">✏️</span>
            </button>
          ) : (
            <div className="qf-contact-row">
              <input
                className="qf-inline-input"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Имя"
              />
              <input
                className="qf-inline-input"
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="Телефон"
                onBlur={() => { if (contactName || contactPhone) setEditingContact(false); }}
              />
            </div>
          )}
        </div>

        <div className="sheet-form-footer">
          <button
            className={`btn btn-lg qf-submit ${category ? "btn-primary" : ""}`}
            onClick={handleSubmit}
            disabled={!category || submitting}
          >
            {submitting
              ? photos.length > 0
                ? "Загрузка фото..."
                : "Отправляем..."
              : category
                ? "Отправить заявку →"
                : "Выберите категорию"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
