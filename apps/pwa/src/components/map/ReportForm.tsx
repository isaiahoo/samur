// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { IncidentType, HelpCategory } from "@samur/shared";
import { INCIDENT_TYPE_LABELS, HELP_CATEGORY_LABELS } from "@samur/shared";
import { useGeolocation } from "../../hooks/useGeolocation.js";
import { useAuthStore } from "../../store/auth.js";
import { useUIStore, confirmAction } from "../../store/ui.js";
import { useOnline } from "../../hooks/useOnline.js";
import { createIncident, createHelpRequest, uploadPhotos } from "../../services/api.js";
import { addToOutbox } from "../../services/db.js";

const MAX_PHOTOS = 5;

type ReportType = "incident" | "help_need" | "help_offer";

interface ReportTypeOption {
  type: IncidentType;
  icon: string;
  label: string;
}

const incidentOptions: ReportTypeOption[] = [
  { type: "flood", icon: "🌊", label: "Затопление" },
  { type: "mudslide", icon: "🏔️", label: "Сель" },
  { type: "landslide", icon: "⛰️", label: "Оползень" },
  { type: "road_blocked", icon: "🚧", label: "Дорога перекрыта" },
  { type: "building_damaged", icon: "🏚️", label: "Повреждение здания" },
  { type: "power_out", icon: "⚡", label: "Нет электричества" },
  { type: "water_contaminated", icon: "💧", label: "Плохая вода" },
];

const helpCategoryOptions: { category: HelpCategory; icon: string }[] = [
  { category: "rescue", icon: "🆘" },
  { category: "shelter", icon: "🏠" },
  { category: "food", icon: "🍞" },
  { category: "water", icon: "💧" },
  { category: "medicine", icon: "💊" },
  { category: "equipment", icon: "🔧" },
  { category: "transport", icon: "🚗" },
  { category: "labor", icon: "💪" },
];

import { reverseGeocode } from "../../services/reverseGeocode.js";

function digitsOnly(phone: string): string {
  return phone.replace(/[\s\-\(\)\+]/g, "");
}
function isValidPhone(phone: string): boolean {
  return digitsOnly(phone).length >= 7;
}

export function ReportForm({ onClose, onCreated }: { onClose: () => void; onCreated?: (lat: number, lng: number) => void }) {
  const [step, setStep] = useState(1);
  const [reportType, setReportType] = useState<ReportType | null>(null);
  const [incidentType, setIncidentType] = useState<IncidentType | null>(null);
  const [helpCategory, setHelpCategory] = useState<HelpCategory | null>(null);
  const [severity, setSeverity] = useState<string>("medium");
  const [description, setDescription] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [address, setAddress] = useState<string>("");
  const [locationLoading, setLocationLoading] = useState(false);
  const addressTouchedRef = useRef(false);
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { position, loading: geoLoading, requestPosition } = useGeolocation();
  const user = useAuthStore((s) => s.user);
  const showToast = useUIStore((s) => s.showToast);
  const online = useOnline();

  // User already has contact info if logged in with phone or messenger
  const hasContactInfo = !!(user && (user.phone || user.tgId || user.vkId));

  useEffect(() => {
    if (user) {
      setContactName(user.name ?? "");
      setContactPhone(user.phone ?? "");
    }
  }, [user]);

  // Reverse-geocode when position is obtained — only fills the
  // address if the user hasn't typed their own (so a partial typed
  // address isn't clobbered by a slow Nominatim response).
  useEffect(() => {
    if (!position) return;
    if (addressTouchedRef.current || address) return;
    let cancelled = false;
    setLocationLoading(true);
    reverseGeocode(position.lat, position.lng).then((name) => {
      if (cancelled) return;
      if (!addressTouchedRef.current && !address && name) {
        setAddress(name);
      }
      setLocationLoading(false);
    });
    return () => { cancelled = true; };
  }, [position, address]);

  /** True once the user has done anything beyond the initial open — used
   * to gate the close path with a confirm so a stray backdrop tap or
   * misfired X-tap doesn't wipe typed content + picked photos. Contact
   * name/phone are seeded from the logged-in user, so compare against
   * those rather than raw truthy. */
  const hasContent = !!(
    reportType ||
    description.trim() ||
    photos.length > 0 ||
    severity !== "medium" ||
    addressTouchedRef.current ||
    (contactName.trim() && contactName !== (user?.name ?? "")) ||
    (contactPhone.trim() && contactPhone !== (user?.phone ?? ""))
  );
  /** Ref mirrors so any effect using attemptClose (Escape keydown,
   * future gesture handlers) doesn't re-register on every keystroke —
   * description lives in component state so every typed character
   * would otherwise churn listeners. */
  const hasContentRef = useRef(hasContent);
  hasContentRef.current = hasContent;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const attemptClose = useCallback(async () => {
    if (hasContentRef.current) {
      const ok = await confirmAction({
        title: "Закрыть?",
        message: "Введённые данные будут потеряны.",
        confirmLabel: "Закрыть",
        kind: "destructive",
      });
      if (!ok) return;
    }
    onCloseRef.current();
  }, []);

  const handleSelectIncident = useCallback((type: IncidentType) => {
    setReportType("incident");
    setIncidentType(type);
    setStep(2);
    requestPosition();
  }, [requestPosition]);

  const handleSelectHelp = useCallback((type: ReportType, category: HelpCategory) => {
    setReportType(type);
    setHelpCategory(category);
    setStep(2);
    requestPosition();
  }, [requestPosition]);

  const handleAddPhotos = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const remaining = MAX_PHOTOS - photos.length;
    const newFiles = Array.from(files).slice(0, remaining);
    const newPhotos = newFiles.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));
    setPhotos((prev) => [...prev, ...newPhotos]);
    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [photos.length]);

  const handleRemovePhoto = useCallback((index: number) => {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleSubmit = async () => {
    if (!position) {
      showToast("Не удалось определить местоположение", "error");
      return;
    }

    setSubmitting(true);

    try {
      // Upload photos first (if any and online)
      let photoUrls: string[] | undefined;
      if (photos.length > 0 && online) {
        try {
          photoUrls = await uploadPhotos(photos.map((p) => p.file));
        } catch {
          showToast("Не удалось загрузить фото", "error");
          setSubmitting(false);
          return;
        }
      }

      if (reportType === "incident" && incidentType) {
        const data = {
          type: incidentType,
          severity,
          lat: position.lat,
          lng: position.lng,
          address: address.trim() || undefined,
          description: description || undefined,
          contactName: contactName.trim() || undefined,
          contactPhone: isValidPhone(contactPhone) ? contactPhone.trim() : undefined,
          photoUrls: photoUrls ?? undefined,
          source: "pwa" as const,
        };

        if (online) {
          await createIncident(data);
          showToast("Сообщение отправлено", "success");
        } else {
          await addToOutbox({ endpoint: "/incidents", method: "POST", body: data });
          showToast("Сохранено. Отправится при подключении к сети", "info");
        }
        onClose();
        onCreated?.(position.lat, position.lng);
      } else if (helpCategory) {
        const data = {
          type: reportType === "help_offer" ? "offer" as const : "need" as const,
          category: helpCategory,
          lat: position.lat,
          lng: position.lng,
          address: address.trim() || undefined,
          description: description || undefined,
          urgency: severity === "critical" ? "critical" as const : severity === "high" ? "urgent" as const : "normal" as const,
          contactName: contactName.trim() || undefined,
          contactPhone: isValidPhone(contactPhone) ? contactPhone.trim() : undefined,
          photoUrls: photoUrls ?? undefined,
          source: "pwa" as const,
        };

        if (online) {
          await createHelpRequest(data);
          showToast("Заявка отправлена", "success");
        } else {
          await addToOutbox({ endpoint: "/help-requests", method: "POST", body: data });
          showToast("Сохранено. Отправится при подключении к сети", "info");
        }
        onClose();
        onCreated?.(position.lat, position.lng);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Ошибка отправки", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <>
      {/* Backdrop and overlay live inside ReportForm now so the close
          flow (X button, Escape, backdrop tap) all route through
          attemptClose and get the same unsaved-content confirm. */}
      <div
        className="report-overlay-backdrop"
        onClick={attemptClose}
        onTouchMove={(e) => e.preventDefault()}
      />
      <div className="report-overlay">
        <div className="report-form">
          <div className="report-form-header">
            <div className="report-form-header-left">
              {step > 1 && (
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setStep(step - 1)}
                  aria-label="Назад"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
              )}
              <h2>Сообщить</h2>
            </div>
            <button type="button" className="btn-close" onClick={attemptClose} aria-label="Закрыть">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="6" y1="18" x2="18" y2="6" />
              </svg>
            </button>
          </div>

      {step === 1 && (
        <div className="report-step">
          <h3>Что произошло?</h3>
          <div className="report-grid">
            {incidentOptions.map((opt) => (
              <button
                key={opt.type}
                className="report-type-btn"
                onClick={() => handleSelectIncident(opt.type)}
              >
                <span className="report-type-icon">{opt.icon}</span>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>

          <h3>Нужна помощь?</h3>
          <div className="report-grid">
            {helpCategoryOptions.map((opt) => (
              <button
                key={`need-${opt.category}`}
                className="report-type-btn"
                onClick={() => handleSelectHelp("help_need", opt.category)}
              >
                <span className="report-type-icon">{opt.icon}</span>
                <span>{HELP_CATEGORY_LABELS[opt.category]}</span>
              </button>
            ))}
          </div>

          <h3>Могу помочь</h3>
          <div className="report-grid">
            {helpCategoryOptions.map((opt) => (
              <button
                key={`offer-${opt.category}`}
                className="report-type-btn report-type-btn--offer"
                onClick={() => handleSelectHelp("help_offer", opt.category)}
              >
                <span className="report-type-icon">{opt.icon}</span>
                <span>{HELP_CATEGORY_LABELS[opt.category]}</span>
              </button>
            ))}
          </div>

          <button className="report-cancel-btn" onClick={attemptClose}>Закрыть</button>
        </div>
      )}

      {step === 2 && (
        <div className="report-step">
          <h3>Адрес</h3>
          {geoLoading && <p className="text-muted">Определяем местоположение...</p>}
          {(position || address) && (
            <div className="form-group">
              <input
                className={`form-input${!address.trim() ? " form-input--error" : ""}`}
                type="text"
                value={locationLoading && !address ? "Определяем адрес..." : address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  addressTouchedRef.current = true;
                }}
                placeholder="Улица, дом, ориентир"
                disabled={locationLoading && !address}
                aria-invalid={!address.trim() ? "true" : undefined}
                autoComplete="street-address"
              />
              {!address.trim() && !locationLoading && (
                <p className="text-muted" style={{ fontSize: 12, marginTop: 4, color: "#dc2626" }}>
                  Укажите адрес — без этого спасатели или волонтёры не знают, куда ехать
                </p>
              )}
              {position && (
                <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Геолокация: {position.lat.toFixed(4)}, {position.lng.toFixed(4)}
                </p>
              )}
            </div>
          )}
          {!position && !geoLoading && (
            <button className="btn btn-secondary" onClick={requestPosition} disabled={geoLoading}>
              Определить местоположение
            </button>
          )}

          <h3>Подробности</h3>
          {reportType === "incident" && (
            <div className="form-group">
              <label>Серьёзность</label>
              <div className="severity-buttons">
                {(["low", "medium", "high", "critical"] as const).map((s) => (
                  <button
                    key={s}
                    className={`btn btn-severity btn-severity--${s} ${severity === s ? "active" : ""}`}
                    onClick={() => setSeverity(s)}
                  >
                    {{ low: "Низкая", medium: "Средняя", high: "Высокая", critical: "Критическая" }[s]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="report-desc">Описание</label>
            <textarea
              id="report-desc"
              className="form-input"
              rows={3}
              maxLength={2000}
              placeholder="Опишите ситуацию..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Фото</label>
            <div className="photo-slots">
              {photos.map((p, i) => (
                <div key={i} className="photo-slot photo-slot--filled">
                  <img src={p.preview} alt="" />
                  <button
                    className="photo-slot-remove"
                    onClick={() => handleRemovePhoto(i)}
                    aria-label="Удалить фото"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="6" y1="6" x2="18" y2="18" />
                      <line x1="6" y1="18" x2="18" y2="6" />
                    </svg>
                  </button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <button
                  className="photo-slot photo-slot--add"
                  onClick={() => fileInputRef.current?.click()}
                >
                  +
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              multiple
              style={{ display: "none" }}
              onChange={handleAddPhotos}
            />
          </div>

          <button
            className="btn btn-primary"
            onClick={() => setStep(3)}
            disabled={!address.trim() || !position}
          >
            {!address.trim() ? "Укажите адрес" : "Далее"}
          </button>
        </div>
      )}

      {step === 3 && (() => {
        const phoneValid = isValidPhone(contactPhone);
        const phoneMissing = !contactPhone.trim();
        return (
          <div className="report-step">
            <h3>Контактные данные</h3>
            <p className="text-muted">
              Телефон обязателен — спасатели или волонтёры должны иметь возможность дозвониться.
            </p>

            <div className="form-group">
              <label htmlFor="report-name">Имя</label>
              <input
                id="report-name"
                className="form-input"
                type="text"
                maxLength={200}
                placeholder="Ваше имя"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                autoComplete="name"
              />
            </div>

            <div className="form-group">
              <label htmlFor="report-phone">Телефон</label>
              <input
                id="report-phone"
                className={`form-input${contactPhone && !phoneValid ? " form-input--error" : ""}`}
                type="tel"
                placeholder="+7 900 123-45-67"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                autoComplete="tel"
                inputMode="tel"
                aria-invalid={contactPhone && !phoneValid ? "true" : undefined}
              />
              {contactPhone && !phoneValid && (
                <p className="text-muted" style={{ fontSize: 12, marginTop: 4, color: "#dc2626" }}>
                  Минимум 7 цифр
                </p>
              )}
              {hasContactInfo && contactPhone === (user?.phone ?? "") && (
                <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Из вашего профиля — можно изменить, если нужно
                </p>
              )}
            </div>

            <button
              className="btn btn-primary btn-lg"
              onClick={handleSubmit}
              disabled={submitting || !position || !address.trim() || phoneMissing || !phoneValid}
            >
              {submitting
                ? "Отправка..."
                : phoneMissing
                  ? "Укажите телефон"
                  : !phoneValid
                    ? "Проверьте телефон"
                    : "Отправить"}
            </button>

            {!online && (
              <p className="text-muted" style={{ marginTop: 8 }}>
                Вы офлайн. Заявка будет отправлена при подключении к сети.
              </p>
            )}
          </div>
        );
      })()}
        </div>
      </div>
    </>,
    document.body,
  );
}
