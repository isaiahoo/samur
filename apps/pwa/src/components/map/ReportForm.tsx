// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useCallback } from "react";
import type { IncidentType, HelpCategory } from "@samur/shared";
import { INCIDENT_TYPE_LABELS, HELP_CATEGORY_LABELS } from "@samur/shared";
import { useGeolocation } from "../../hooks/useGeolocation.js";
import { useAuthStore } from "../../store/auth.js";
import { useUIStore } from "../../store/ui.js";
import { useOnline } from "../../hooks/useOnline.js";
import { createIncident, createHelpRequest } from "../../services/api.js";
import { addToOutbox } from "../../services/db.js";

type ReportType = "incident" | "help_need" | "help_offer";

interface ReportTypeOption {
  type: IncidentType;
  icon: string;
  label: string;
}

const incidentOptions: ReportTypeOption[] = [
  { type: "flood", icon: "🌊", label: "Затопление" },
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

export function ReportForm({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [reportType, setReportType] = useState<ReportType | null>(null);
  const [incidentType, setIncidentType] = useState<IncidentType | null>(null);
  const [helpCategory, setHelpCategory] = useState<HelpCategory | null>(null);
  const [severity, setSeverity] = useState<string>("medium");
  const [description, setDescription] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { position, loading: geoLoading, requestPosition } = useGeolocation();
  const user = useAuthStore((s) => s.user);
  const showToast = useUIStore((s) => s.showToast);
  const online = useOnline();

  useState(() => {
    if (user) {
      setContactName(user.name ?? "");
      setContactPhone(user.phone ?? "");
    }
  });

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

  const handleSubmit = async () => {
    if (!position) {
      showToast("Не удалось определить местоположение", "error");
      return;
    }

    setSubmitting(true);

    try {
      if (reportType === "incident" && incidentType) {
        const data = {
          type: incidentType,
          severity,
          lat: position.lat,
          lng: position.lng,
          description: description || undefined,
          source: "pwa" as const,
        };

        if (online) {
          await createIncident(data);
          showToast("Сообщение отправлено", "success");
        } else {
          await addToOutbox({ endpoint: "/incidents", method: "POST", body: data });
          showToast("Сохранено. Отправится при подключении к сети", "info");
        }
      } else if (helpCategory) {
        const data = {
          type: reportType === "help_offer" ? "offer" as const : "need" as const,
          category: helpCategory,
          lat: position.lat,
          lng: position.lng,
          description: description || undefined,
          urgency: severity === "critical" ? "critical" as const : severity === "high" ? "urgent" as const : "normal" as const,
          contactName: contactName || undefined,
          contactPhone: contactPhone || undefined,
          source: "pwa" as const,
        };

        if (online) {
          await createHelpRequest(data);
          showToast("Заявка отправлена", "success");
        } else {
          await addToOutbox({ endpoint: "/help-requests", method: "POST", body: data });
          showToast("Сохранено. Отправится при подключении к сети", "info");
        }
      }

      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Ошибка отправки", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="report-form">
      <div className="report-form-header">
        <h2>Сообщить</h2>
        <button className="btn-close" onClick={onClose} aria-label="Закрыть">✕</button>
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
        </div>
      )}

      {step === 2 && (
        <div className="report-step">
          <h3>Местоположение</h3>
          {geoLoading && <p className="text-muted">Определяем местоположение...</p>}
          {position && (
            <p className="text-success">
              Координаты: {position.lat.toFixed(4)}, {position.lng.toFixed(4)}
            </p>
          )}
          {!position && !geoLoading && (
            <button className="btn btn-secondary" onClick={requestPosition}>
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

          <button className="btn btn-primary" onClick={() => setStep(3)}>
            Далее
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="report-step">
          <h3>Контактные данные</h3>
          <p className="text-muted">Необязательно, но поможет быстрее оказать помощь</p>

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
            />
          </div>

          <div className="form-group">
            <label htmlFor="report-phone">Телефон</label>
            <input
              id="report-phone"
              className="form-input"
              type="tel"
              placeholder="+79001234567"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
            />
          </div>

          <button
            className="btn btn-primary btn-lg"
            onClick={handleSubmit}
            disabled={submitting || !position}
          >
            {submitting ? "Отправка..." : "Отправить"}
          </button>

          {!online && (
            <p className="text-muted" style={{ marginTop: 8 }}>
              Вы офлайн. Заявка будет отправлена при подключении к сети.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
