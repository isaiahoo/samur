// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import type { AlertUrgency, Channel } from "@samur/shared";
import { ALERT_URGENCY_LABELS, CHANNELS, SOURCE_LABELS } from "@samur/shared";
import { createAlert } from "../../services/api.js";
import { useUIStore } from "../../store/ui.js";

export function AlertComposer() {
  const [urgency, setUrgency] = useState<AlertUrgency>("warning");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [channels, setChannels] = useState<Channel[]>(["pwa"]);
  const [expiresIn, setExpiresIn] = useState("24"); // hours
  const [submitting, setSubmitting] = useState(false);

  const showToast = useUIStore((s) => s.showToast);

  const toggleChannel = (ch: Channel) => {
    setChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch],
    );
  };

  const handleSubmit = async () => {
    if (!title.trim() || !body.trim()) {
      showToast("Заполните заголовок и текст", "error");
      return;
    }
    if (channels.length === 0) {
      showToast("Выберите хотя бы один канал", "error");
      return;
    }

    setSubmitting(true);
    try {
      const expiresAt = expiresIn
        ? new Date(Date.now() + Number(expiresIn) * 3600000).toISOString()
        : undefined;

      await createAlert({
        urgency,
        title: title.trim(),
        body: body.trim(),
        channels,
        expiresAt,
      });

      showToast("Оповещение отправлено", "success");
      setTitle("");
      setBody("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Ошибка", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="alert-composer">
      <div className="form-group">
        <label>Срочность</label>
        <div className="urgency-buttons">
          {(["info", "warning", "critical"] as const).map((u) => (
            <button
              key={u}
              className={`btn btn-urgency btn-urgency--${u} ${urgency === u ? "active" : ""}`}
              onClick={() => setUrgency(u)}
            >
              {ALERT_URGENCY_LABELS[u]}
            </button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="alert-title">Заголовок</label>
        <input
          id="alert-title"
          className="form-input"
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Краткий заголовок оповещения"
        />
      </div>

      <div className="form-group">
        <label htmlFor="alert-body">Текст</label>
        <textarea
          id="alert-body"
          className="form-input"
          rows={5}
          maxLength={5000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Подробный текст оповещения..."
        />
      </div>

      <div className="form-group">
        <label>Каналы</label>
        <div className="channel-checkboxes">
          {CHANNELS.map((ch) => (
            <label key={ch} className="checkbox-label">
              <input
                type="checkbox"
                checked={channels.includes(ch)}
                onChange={() => toggleChannel(ch)}
              />
              <span>{SOURCE_LABELS[ch]}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="alert-expires">Истекает через (часов)</label>
        <select id="alert-expires" className="form-input" value={expiresIn} onChange={(e) => setExpiresIn(e.target.value)}>
          <option value="1">1 час</option>
          <option value="6">6 часов</option>
          <option value="12">12 часов</option>
          <option value="24">24 часа</option>
          <option value="48">48 часов</option>
          <option value="">Бессрочно</option>
        </select>
      </div>

      <button
        className="btn btn-primary btn-lg"
        onClick={handleSubmit}
        disabled={submitting}
      >
        {submitting ? "Отправка..." : "Отправить оповещение"}
      </button>
    </div>
  );
}
