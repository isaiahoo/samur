// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import type { HelpMessageReportReason } from "@samur/shared";
import { HELP_MESSAGE_REPORT_REASON_LABELS } from "@samur/shared";
import { BottomSheet } from "./BottomSheet.js";

interface Props {
  onClose: () => void;
  onSubmit: (reason: HelpMessageReportReason, details?: string) => void | Promise<void>;
}

const REASONS: HelpMessageReportReason[] = ["abuse", "doxxing", "spam", "off_topic", "other"];

/** Small bottom-sheet form for reporting a chat message. The reason is
 * required; free-text details are optional (max 500 chars). */
export function ReportMessageSheet({ onClose, onSubmit }: Props) {
  const [reason, setReason] = useState<HelpMessageReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(reason, details.trim() || undefined);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BottomSheet onClose={onClose}>
      <div className="report-sheet">
        <h3 className="report-sheet-title">Пожаловаться на сообщение</h3>
        <p className="report-sheet-subtitle">
          Модератор рассмотрит жалобу и при необходимости удалит сообщение.
        </p>

        <fieldset className="report-sheet-reasons">
          <legend className="report-sheet-legend">Причина</legend>
          {REASONS.map((r) => (
            <label key={r} className={`report-sheet-reason${reason === r ? " report-sheet-reason--active" : ""}`}>
              <input
                type="radio"
                name="reason"
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
              />
              <span>{HELP_MESSAGE_REPORT_REASON_LABELS[r]}</span>
            </label>
          ))}
        </fieldset>

        <label className="report-sheet-details-label">
          <span>Комментарий (необязательно)</span>
          <textarea
            className="report-sheet-details"
            rows={3}
            maxLength={500}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Что именно не так?"
          />
        </label>

        <div className="report-sheet-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Отмена
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={!reason || submitting}
          >
            {submitting ? "Отправка…" : "Отправить"}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
