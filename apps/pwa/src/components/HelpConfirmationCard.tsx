// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";
import type { HelpResponse } from "@samur/shared";
import {
  confirmHelpResponse,
  rejectHelpResponse,
  undoRejectHelpResponse,
  ApiError,
} from "../services/api.js";
import { useUIStore } from "../store/ui.js";

interface Props {
  requestId: string;
  response: HelpResponse;
  onChange: () => void | Promise<void>;
}

/**
 * Кунак-рукопожатие prompt shown inline to the request author once a
 * responder marks status=helped. Three gestures: "Спасибо" (with
 * optional public note), "Что-то не получилось" (silent, undoable for
 * 24h), or "Позже" (dismissed locally, card reappears on next load).
 */
export function HelpConfirmationCard({ requestId, response, onChange }: Props) {
  const [mode, setMode] = useState<"prompt" | "thanking" | "submitting">("prompt");
  const [note, setNote] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const showToast = useUIStore((s) => s.showToast);

  // If the response identity changes (parent swaps helpers, or this row
  // gets re-keyed) reset the "позже" dismissal so the new card surfaces.
  useEffect(() => {
    setDismissed(false);
  }, [response.id]);

  const helperName = response.user?.name ?? "Помощник";

  const handleConfirm = async () => {
    setMode("submitting");
    try {
      await confirmHelpResponse(requestId, response.id, {
        thankYouNote: note.trim() || undefined,
        anonymous,
      });
      showToast(`Спасибо отправлено ${helperName}`, "success");
      await onChange();
    } catch (e) {
      setMode("thanking");
      showToast(e instanceof ApiError ? e.message : "Не удалось отправить спасибо", "error");
    }
  };

  const handleReject = async () => {
    setMode("submitting");
    try {
      await rejectHelpResponse(requestId, response.id);
      showToast("Отмечено · отменить можно в течение 24 часов", "info");
      await onChange();
    } catch (e) {
      setMode("prompt");
      showToast(e instanceof ApiError ? e.message : "Не получилось сохранить", "error");
    }
  };

  const handleUndoReject = async () => {
    try {
      await undoRejectHelpResponse(requestId, response.id);
      showToast("Отмена снята", "success");
      await onChange();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : "Не удалось отменить", "error");
    }
  };

  // Post-rejection state — small undo affordance for 24h.
  if (response.rejectedAt) {
    const ageMs = Date.now() - new Date(response.rejectedAt).getTime();
    const canUndo = ageMs < 24 * 60 * 60 * 1000;
    return (
      <div className="kunak-confirm kunak-confirm--rejected">
        <span>Отмечено · не оказана</span>
        {canUndo && (
          <button type="button" className="kunak-confirm-undo" onClick={handleUndoReject}>
            Отменить
          </button>
        )}
      </div>
    );
  }

  if (response.confirmedAt) {
    return (
      <div className="kunak-confirm kunak-confirm--done">
        🤝 Вы сказали спасибо
      </div>
    );
  }

  if (dismissed) return null;

  if (mode === "thanking" || mode === "submitting") {
    return (
      <div className="kunak-confirm kunak-confirm--form">
        <div className="kunak-confirm-title">Скажите спасибо {helperName}</div>
        <textarea
          className="kunak-confirm-note"
          placeholder="Добавьте пару слов (по желанию) — это появится в профиле помощника"
          maxLength={280}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={mode === "submitting"}
        />
        <label className="kunak-confirm-anon">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
            disabled={mode === "submitting"}
          />
          <span>Скрыть моё имя в благодарности</span>
        </label>
        <div className="kunak-confirm-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleConfirm}
            disabled={mode === "submitting"}
          >
            {mode === "submitting" ? "Отправляем…" : "🤝 Отправить"}
          </button>
          <button
            type="button"
            className="kunak-confirm-cancel"
            onClick={() => setMode("prompt")}
            disabled={mode === "submitting"}
          >
            Назад
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="kunak-confirm kunak-confirm--prompt">
      <div className="kunak-confirm-title">
        {helperName} отметил, что помог вам
      </div>
      <div className="kunak-confirm-subtitle">
        Скажите спасибо — это откроет награду и появится в профиле помощника.
      </div>
      <div className="kunak-confirm-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setMode("thanking")}
        >
          🤝 Сказать спасибо
        </button>
        <button
          type="button"
          className="kunak-confirm-secondary"
          onClick={handleReject}
        >
          Что-то не получилось
        </button>
        <button
          type="button"
          className="kunak-confirm-later"
          onClick={() => setDismissed(true)}
        >
          Позже
        </button>
      </div>
    </div>
  );
}
