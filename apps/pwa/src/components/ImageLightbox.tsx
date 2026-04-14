// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useRef, useCallback } from "react";

interface Props {
  urls: string[];
  initialIndex: number;
  onClose: () => void;
}

export function ImageLightbox({ urls, initialIndex, onClose }: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [offsetX, setOffsetX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const touchRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);

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
    setOffsetX(0);
    setSwiping(false);
    touchRef.current = null;
  }, [offsetX, index, urls.length]);

  return (
    <div className="lightbox" onClick={onClose}>
      <span className="lightbox-counter">
        {index + 1} / {urls.length}
      </span>
      <button className="lightbox-close" onClick={onClose} aria-label="Закрыть">
        ✕
      </button>

      <div
        className="lightbox-track"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={(e) => e.stopPropagation()}
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
    </div>
  );
}
