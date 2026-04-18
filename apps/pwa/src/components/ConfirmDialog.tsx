// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useUIStore } from "../store/ui.js";

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

  useEffect(() => {
    if (!req) return;
    const t = requestAnimationFrame(() => confirmBtnRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [req]);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        resolve(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        resolve(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [req, resolve]);

  // Hardware / browser back closes the dialog (as cancel) instead of
  // navigating away. Same pattern as BottomSheet / ImageLightbox.
  useEffect(() => {
    if (!req) return;
    window.history.pushState({ [DIALOG_STATE_MARKER]: true }, "");
    const onPopState = (e: PopStateEvent) => {
      if (e.state?.[DIALOG_STATE_MARKER]) return;
      resolve(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (window.history.state?.[DIALOG_STATE_MARKER]) {
        window.history.back();
      }
    };
  }, [req, resolve]);

  if (!req) return null;

  const cancelLabel = req.cancelLabel ?? "Отмена";
  const confirmLabel = req.confirmLabel ?? "Подтвердить";

  return createPortal(
    <div className="confirm-overlay" onClick={() => resolve(false)}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
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
            onClick={() => resolve(false)}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`btn ${req.destructive ? "btn-danger" : "btn-primary"}`}
            onClick={() => resolve(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
