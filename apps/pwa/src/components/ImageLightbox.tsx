// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

interface Props {
  urls: string[];
  initialIndex: number;
  onClose: () => void;
}

/** Marker we attach to the synthetic history entry so popstate can tell
 * "user backed out of the lightbox" from "some other history pop
 * happened underneath us". Also lets a parent sheet's popstate handler
 * recognise its own state and skip. */
const LIGHTBOX_STATE_MARKER = "kunakLightbox";

export function ImageLightbox({ urls, initialIndex, onClose }: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [offsetX, setOffsetX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const touchRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
  /** Set to true when a touchend finishes a real swipe, so the synthetic
   * click that fires afterwards doesn't also close the lightbox.
   * Cleared on the next overlay click. */
  const suppressClickRef = useRef(false);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < urls.length - 1) setIndex((i) => i + 1);
      if (e.key === "ArrowLeft" && index > 0) setIndex((i) => i - 1);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [index, urls.length, onClose]);

  // Hardware / browser back closes the lightbox instead of navigating
  // off the page. Same pattern as HelpDetailSheet — push one synthetic
  // entry on mount, consume it on popstate or on clean unmount.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    window.history.pushState({ [LIGHTBOX_STATE_MARKER]: true }, "");
    const onPopState = (e: PopStateEvent) => {
      // e.state carries the state we're landing on. If it still has our
      // marker, someone else (e.g. a nested overlay) popped — not us.
      if (e.state?.[LIGHTBOX_STATE_MARKER]) return;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (window.history.state?.[LIGHTBOX_STATE_MARKER]) {
        window.history.back();
      }
    };
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchRef.current = { startX: t.clientX, startY: t.clientY, moved: false };
    setSwiping(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchRef.current) return;
    const dx = e.touches[0].clientX - touchRef.current.startX;
    const dy = e.touches[0].clientY - touchRef.current.startY;
    // If mostly vertical scroll, ignore
    if (!touchRef.current.moved && Math.abs(dy) > Math.abs(dx)) {
      touchRef.current = null;
      setSwiping(false);
      setOffsetX(0);
      return;
    }
    touchRef.current.moved = true;
    setOffsetX(dx);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!touchRef.current) return;
    const threshold = 50;
    if (offsetX < -threshold && index < urls.length - 1) {
      setIndex((i) => i + 1);
    } else if (offsetX > threshold && index > 0) {
      setIndex((i) => i - 1);
    }
    // If the user actually dragged, the UA will still fire a synthetic
    // click after touchend — swallow that one so a swipe doesn't also
    // close the lightbox. A clean tap leaves the ref false and the
    // overlay's onClick closes as expected.
    if (touchRef.current.moved) {
      suppressClickRef.current = true;
    }
    setOffsetX(0);
    setSwiping(false);
    touchRef.current = null;
  }, [offsetX, index, urls.length]);

  /** Every tap inside the lightbox closes unless it was the tail end of
   * a swipe gesture. The close-button stops propagation so this doesn't
   * fire twice when it's tapped directly. */
  const handleOverlayClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onClose();
  }, [onClose]);

  // Portal to document.body — any transformed ancestor (e.g. the card's
  // fade-in animation leaves transform:translateY(0) applied, which creates
  // a containing block) would otherwise trap the fixed-position overlay
  // inside the card and hide the close button.
  return createPortal(
    <div className="lightbox" onClick={handleOverlayClick}>
      <span className="lightbox-counter">
        {index + 1} / {urls.length}
      </span>
      <button
        className="lightbox-close"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Закрыть"
      >
        ✕
      </button>

      <div
        className="lightbox-track"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: swiping ? "none" : "transform 0.25s ease-out",
        }}
      >
        <img
          className="lightbox-img"
          src={urls[index]}
          alt=""
          draggable={false}
        />
      </div>

      {urls.length > 1 && (
        <div className="lightbox-dots">
          {urls.map((_, i) => (
            <span
              key={i}
              className={`lightbox-dot ${i === index ? "lightbox-dot--active" : ""}`}
            />
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
