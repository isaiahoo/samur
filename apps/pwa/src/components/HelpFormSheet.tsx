// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useRef, useCallback, type ChangeEvent } from "react";
import type { HelpCategory } from "@samur/shared";
import { HELP_CATEGORIES, HELP_CATEGORY_LABELS } from "@samur/shared";
import { createHelpRequest, uploadPhotos } from "../services/api.js";
import { useAuthStore } from "../store/auth.js";
import { useUIStore } from "../store/ui.js";
import { useGeolocation } from "../hooks/useGeolocation.js";
import { compressImage } from "../utils/compressImage.js";

interface Props {
  tab: "need" | "offer";
  onClose: () => void;
}

export function HelpFormSheet({ tab, onClose }: Props) {
  const [category, setCategory] = useState<HelpCategory>("rescue");
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
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

  // Lock body scroll (iOS Safari needs position:fixed to truly prevent scroll)
  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = "";
      body.style.top = "";
      body.style.left = "";
      body.style.right = "";
      body.style.overflow = "";
      window.scrollTo(0, scrollY);
    };
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
          // Take first 2-3 parts (street, house, district)
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

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet sheet--tall" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-form-header">
          <h3>{tab === "offer" ? "Предложить помощь" : "Запросить помощь"}</h3>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <div className="sheet-form-body">
          {/* Geo indicator */}
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

          <div className="form-group">
            <label>Категория</label>
            <select
              className="form-input"
              value={category}
              onChange={(e) => setCategory(e.target.value as HelpCategory)}
            >
              {HELP_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {HELP_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Срочность</label>
            <select
              className="form-input"
              value={urgency}
              onChange={(e) => setUrgency(e.target.value)}
            >
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
            <label>Адрес</label>
            <input
              className="form-input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Улица, дом, район..."
            />
          </div>

          <div className="form-group">
            <label>Фото (до 5 шт.)</label>
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
            {photoPreviews.length > 0 && (
              <div className="photo-previews">
                {photoPreviews.map((url, i) => (
                  <div key={i} className="photo-preview">
                    <img src={url} alt="" />
                    <button
                      type="button"
                      className="photo-preview-remove"
                      onClick={() => removePhoto(i)}
                      aria-label="Удалить фото"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
            {photos.length < 5 && (
              <div className="photo-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm photo-add-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={compressing}
                >
                  <svg
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="m21 15-5-5L5 21" />
                  </svg>
                  {compressing
                    ? "Сжатие..."
                    : photos.length === 0
                      ? "Выбрать фото"
                      : `Ещё (${photos.length}/5)`}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm photo-add-btn"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={compressing}
                >
                  <svg
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  Камера
                </button>
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Имя</label>
            <input
              className="form-input"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Телефон</label>
            <input
              className="form-input"
              type="tel"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+79001234567"
            />
          </div>
        </div>

        <div className="sheet-form-footer">
          <button
            className="btn btn-primary btn-lg"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting
              ? photos.length > 0
                ? "Загрузка фото..."
                : "Отправка..."
              : "Отправить"}
          </button>
        </div>
      </div>
    </div>
  );
}
