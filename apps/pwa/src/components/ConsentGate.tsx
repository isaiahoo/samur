// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";
import { getMyConsent, recordConsent, ApiError } from "../services/api.js";
import { useAuthStore } from "../store/auth.js";
import { useUIStore } from "../store/ui.js";
import { ConsentCheckboxes } from "./ConsentCheckboxes.js";

/**
 * 152-ФЗ consent gate for already-authenticated users.
 *
 * Why this exists: at deploy-time every pre-existing account has zero
 * ConsentLog rows — we cannot legally process their PD until they
 * actually accept the (now-published) Privacy Policy. Rather than
 * back-fill consent (not legally defensible), we block them on first
 * post-deploy login with a forward-only acceptance modal.
 *
 * Also re-prompts when the policy version changes — the stored
 * consentVersion no longer matches the current SHA, so the user must
 * re-acknowledge.
 *
 * Mounted once inside Layout (only ever shown to logged-in users).
 */
export function ConsentGate() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn());
  const showToast = useUIStore((s) => s.showToast);

  const [needsGate, setNeedsGate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) {
      setNeedsGate(false);
      return;
    }
    let cancelled = false;
    getMyConsent()
      .then((res) => {
        if (cancelled) return;
        const data = res.data as {
          processing: { accepted: boolean; version: string } | null;
          currentVersion: string;
        } | undefined;
        if (!data) return;
        const proc = data.processing;
        const accepted = proc?.accepted === true;
        const sameVersion = proc?.version === data.currentVersion;
        if (!accepted || !sameVersion) {
          setNeedsGate(true);
        }
      })
      .catch(() => {
        // Soft-fail: if /consent/me errors (network blip, server down),
        // we don't want to lock the user out — they can still use the
        // app, and the gate will re-evaluate on the next reload.
      });
    return () => { cancelled = true; };
  }, [isLoggedIn]);

  const handleSubmit = async () => {
    if (!processing || submitting) return;
    setSubmitting(true);
    try {
      // Two writes — keep them sequential so a partial failure (network
      // drop after the first POST) leaves the user with at least the
      // required processing consent recorded. Distribution is implicit
      // in the policy text now (single-checkbox UX); we still write the
      // row so the audit trail captures both grants from the same event.
      await recordConsent("processing", true);
      await recordConsent("distribution", true);
      setNeedsGate(false);
      showToast("Спасибо! Согласие сохранено.", "success");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Не удалось сохранить согласие";
      showToast(msg, "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (!needsGate) return null;

  return (
    <div className="consent-gate-overlay" role="dialog" aria-modal="true" aria-labelledby="consent-gate-title">
      <div className="consent-gate-card">
        <h2 id="consent-gate-title" className="consent-gate-title">
          Обновлённая Политика конфиденциальности
        </h2>
        <p className="consent-gate-body">
          Мы опубликовали политику обработки персональных данных в
          соответствии с 152-ФЗ. Чтобы продолжить пользоваться Кунаком,
          подтвердите согласие.
        </p>

        <ConsentCheckboxes
          processing={processing}
          onProcessingChange={setProcessing}
          disabled={submitting}
        />

        <button
          type="button"
          className="btn btn-primary btn-lg"
          onClick={handleSubmit}
          disabled={!processing || submitting}
        >
          {submitting ? "Сохранение..." : "Принять и продолжить"}
        </button>
      </div>
    </div>
  );
}
