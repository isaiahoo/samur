// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUIStore } from "../store/ui.js";

/** Minimum time the confirm button shows its spinner once tapped. Short
 * actions (pure client state flips) would otherwise finish in < 1 frame
 * and the dialog would vanish before the user's finger left the button —
 * feels abrupt. 400 ms is long enough to read as a deliberate handoff,
 * short enough to not feel sluggish. */
const MIN_BUSY_MS = 400;

/** Marker on the synthetic history entry we push while the dialog is
 * open. Mirrors the BottomSheet pattern so hardware back cancels the
 * dialog instead of navigating away. Distinct marker so dialogs stack
 * cleanly above sheets. */
const DIALOG_STATE_MARKER = "kunakConfirmDialog";

/** Centered alert-style confirmation dialog. Renders whenever a caller
 * invokes `useUIStore.confirm(opts)`; Promise resolves to true on
 * confirm, false on cancel / backdrop / escape / back-button.
 *
 * Mounted once in <Layout /> so any component anywhere can trigger it
 * without plumbing state through props. */
export function ConfirmDialog() {
  const req = useUIStore((s) => s.confirmRequest);
  const resolve = useUIStore((s) => s.resolveConfirm);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);

  // Reset busy state whenever a new request comes in (or the dialog closes).
  useEffect(() => {
    if (!req) setBusy(false);
  }, [req]);

  useEffect(() => {
    if (!req) return;
    const t = requestAnimationFrame(() => confirmBtnRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [req]);

  const cancel = () => {
    if (busy) return;
    resolve(false);
  };

  const confirm = async () => {
    if (busy) return;
    if (!req?.onConfirm) {
      resolve(true);
      return;
    }
    setBusy(true);
    const started = Date.now();
    try {
      await req.onConfirm();
    } finally {
      const elapsed = Date.now() - started;
      const remaining = MIN_BUSY_MS - elapsed;
      if (remaining > 0) {
        await new Promise((r) => setTimeout(r, remaining));
      }
      resolve(true);
    }
  };

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        confirm();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req, busy]);

  // Hardware / browser back closes the dialog (as cancel) instead of
  // navigating away. Same pattern as BottomSheet / ImageLightbox.
  // While busy, back is swallowed — the async handler owns the flow
  // until it settles so we don't leave half-completed logout / revoke.
  useEffect(() => {
    if (!req) return;
    window.history.pushState({ [DIALOG_STATE_MARKER]: true }, "");
    const onPopState = (e: PopStateEvent) => {
      if (e.state?.[DIALOG_STATE_MARKER]) return;
      if (busy) {
        window.history.pushState({ [DIALOG_STATE_MARKER]: true }, "");
        return;
      }
      resolve(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (window.history.state?.[DIALOG_STATE_MARKER]) {
        window.history.back();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req, busy]);

  if (!req) return null;

  const cancelLabel = req.cancelLabel ?? "Отмена";
  const confirmLabel = req.confirmLabel ?? "Подтвердить";

  return createPortal(
    <div className="confirm-overlay" onClick={cancel}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby="confirm-title"
        aria-describedby={req.message ? "confirm-message" : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="confirm-title">{req.title}</h2>
        {req.message && <p id="confirm-message" className="confirm-message">{req.message}</p>}
        <div className="confirm-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={cancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`btn ${req.destructive ? "btn-danger" : "btn-primary"} confirm-btn`}
            onClick={confirm}
            disabled={busy}
            aria-live="polite"
          >
            {busy ? <span className="confirm-btn-spinner" aria-hidden="true" /> : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
