// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Marker on the synthetic history entry we push while the sheet is
 * open. Used by popstate (ignore non-ours) and the unmount cleanup
 * (consume the entry only when it's still on top). Distinct from the
 * markers used by HelpDetailSheet / ImageLightbox so they can stack. */
const SHEET_STATE_MARKER = "kunakBottomSheet";

/** Fraction of the sheet's own height past which a downward drag
 * commits to close. Less than this snaps back. Keep in sync with
 * VELOCITY_THRESHOLD — either condition closes. */
const CLOSE_DISTANCE_FRACTION = 0.3;
/** px/ms — a quick flick closes even if the drag was short. */
const CLOSE_VELOCITY_THRESHOLD = 0.5;

interface Props {
  children: ReactNode;
  onClose: () => void;
}

export function BottomSheet({ children, onClose }: Props) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const sheetRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  /** Captured on touchstart so touchend can compute velocity. */
  const dragStartRef = useRef<{ y: number; t: number } | null>(null);
  /** Set after a threshold-met touchend so the closing animation plays
   * via CSS transition without re-activating drag state. */
  const closingRef = useRef(false);

  // Body scroll lock — prevents the page behind the sheet from scrolling
  // while the user interacts with sheet content.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Escape to close (desktop / external keyboard).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Bind to browser history so the hardware / browser back button closes
  // the sheet instead of navigating the user off the page. Same pattern
  // as HelpDetailSheet and ImageLightbox, distinct marker so they stack.
  useEffect(() => {
    window.history.pushState({ [SHEET_STATE_MARKER]: true }, "");
    const onPopState = (e: PopStateEvent) => {
      if (e.state?.[SHEET_STATE_MARKER]) return;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (window.history.state?.[SHEET_STATE_MARKER]) {
        window.history.back();
      }
    };
  }, []);

  const requestClose = () => {
    if (window.history.state?.[SHEET_STATE_MARKER]) {
      window.history.back();
    } else {
      onCloseRef.current();
    }
  };

  // Drag-to-dismiss. Handlers live only on the top drag strip — touching
  // scrollable content inside the sheet doesn't initiate a drag, so
  // scrolling within the sheet still works normally.
  const handleTouchStart = (e: React.TouchEvent) => {
    if (closingRef.current) return;
    const t = e.touches[0];
    dragStartRef.current = { y: t.clientY, t: Date.now() };
    setDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragStartRef.current) return;
    const dy = e.touches[0].clientY - dragStartRef.current.y;
    // Upward drag does nothing — clamp at 0 so the sheet can't float
    // above its resting position.
    setDragY(Math.max(0, dy));
  };

  const handleTouchEnd = () => {
    if (!dragStartRef.current) return;
    const elapsed = Math.max(1, Date.now() - dragStartRef.current.t);
    const velocity = dragY / elapsed;
    const height = sheetRef.current?.offsetHeight ?? 600;
    const shouldClose =
      dragY > height * CLOSE_DISTANCE_FRACTION || velocity > CLOSE_VELOCITY_THRESHOLD;

    if (shouldClose) {
      // Animate the sheet the rest of the way down via the CSS
      // transition (re-enabled by setting dragging=false), then fire
      // onClose once the transform is committed.
      closingRef.current = true;
      setDragging(false);
      setDragY(height);
      window.setTimeout(() => { requestClose(); }, 220);
    } else {
      setDragging(false);
      setDragY(0);
    }
    dragStartRef.current = null;
  };

  return createPortal(
    <div className="sheet-overlay" onClick={requestClose}>
      <div
        ref={sheetRef}
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: dragging ? "none" : "transform 0.25s ease-out",
        }}
      >
        <div
          className="sheet-drag-area"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="sheet-handle" />
        </div>
        <div className="sheet-content">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
