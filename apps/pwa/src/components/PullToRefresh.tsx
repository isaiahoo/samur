// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState, type ReactNode } from "react";

const THRESHOLD = 72;
const MAX_PULL = 140;
const RESISTANCE = 0.5;

interface Props {
  onRefresh: () => void | Promise<void>;
  children: ReactNode;
  disabled?: boolean;
}

/** Pull-to-refresh wrapper. Finds its nearest scrollable ancestor, tracks
 * touch drags past a threshold, and on commit calls onRefresh.
 *
 * Requires the host scroll container to have overscroll-behavior: contain
 * (or none) so native browser PTR doesn't compete. The `.tab-alive`
 * scroller used by pages under <Layout> already does — see index.css.
 *
 * The touchmove hot path writes transforms directly to the indicator and
 * content refs (skipping React state) — setState per pixel of finger
 * travel re-renders the tree and caused noticeable jank on mid-range
 * Android. State is only used for committed transitions (refreshing,
 * indicator-ready style flip). */
export function PullToRefresh({ onRefresh, children, disabled }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  /** onRefresh can be re-created every parent render (e.g. inline arrow
   * in NewsPage). Ref-reading it keeps the touch-effect stable so we
   * don't tear down listeners on every parent render. */
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const refreshingRef = useRef(false);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const [refreshing, setRefreshing] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let el: HTMLElement | null = hostRef.current;
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY)) {
        scrollerRef.current = el;
        return;
      }
      el = el.parentElement;
    }
    scrollerRef.current = document.scrollingElement as HTMLElement | null;
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let startY: number | null = null;
    let pull = 0;
    let readyLocal = false;

    const setIndicatorTransform = (distance: number) => {
      const ind = indicatorRef.current;
      const con = contentRef.current;
      if (ind) {
        ind.style.transform = `translateY(${distance - 40}px)`;
        ind.style.opacity = String(Math.min(1, distance / 40));
      }
      if (con) {
        con.style.transform = `translateY(${distance}px)`;
        con.style.transition = "none";
      }
    };

    const resetTransform = () => {
      const ind = indicatorRef.current;
      const con = contentRef.current;
      if (ind) {
        ind.style.transform = "translateY(-40px)";
        ind.style.opacity = "0";
      }
      if (con) {
        con.style.transform = "translateY(0)";
        con.style.transition = "transform 0.22s ease-out";
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (disabledRef.current || refreshingRef.current) return;
      if ((scrollerRef.current?.scrollTop ?? 0) > 0) return;
      if (!e.touches[0]) return;
      startY = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY === null || !e.touches[0]) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) {
        if (pull !== 0) {
          pull = 0;
          resetTransform();
        }
        startY = null;
        return;
      }
      if (e.cancelable) e.preventDefault();
      pull = Math.min(dy * RESISTANCE, MAX_PULL);
      setIndicatorTransform(pull);
      const nextReady = pull >= THRESHOLD;
      if (nextReady !== readyLocal) {
        readyLocal = nextReady;
        setReady(nextReady);
      }
    };

    const onTouchEnd = async () => {
      if (startY === null && pull === 0) return;
      startY = null;
      if (pull >= THRESHOLD) {
        refreshingRef.current = true;
        setRefreshing(true);
        pull = THRESHOLD;
        if (indicatorRef.current) {
          indicatorRef.current.style.transform = `translateY(${THRESHOLD - 40}px)`;
          indicatorRef.current.style.opacity = "1";
        }
        if (contentRef.current) {
          contentRef.current.style.transform = `translateY(${THRESHOLD}px)`;
          contentRef.current.style.transition = "transform 0.22s ease-out";
        }
        try {
          await onRefreshRef.current();
        } finally {
          refreshingRef.current = false;
          setRefreshing(false);
          pull = 0;
          readyLocal = false;
          setReady(false);
          resetTransform();
        }
      } else {
        pull = 0;
        if (readyLocal) {
          readyLocal = false;
          setReady(false);
        }
        resetTransform();
      }
    };

    host.addEventListener("touchstart", onTouchStart, { passive: true });
    host.addEventListener("touchmove", onTouchMove, { passive: false });
    host.addEventListener("touchend", onTouchEnd);
    host.addEventListener("touchcancel", onTouchEnd);
    return () => {
      host.removeEventListener("touchstart", onTouchStart);
      host.removeEventListener("touchmove", onTouchMove);
      host.removeEventListener("touchend", onTouchEnd);
      host.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  return (
    <div ref={hostRef} className="ptr-host">
      <div
        ref={indicatorRef}
        className={`ptr-indicator${ready ? " ptr-indicator--ready" : ""}${refreshing ? " ptr-indicator--refreshing" : ""}`}
        style={{ transform: "translateY(-40px)", opacity: 0 }}
        aria-hidden={!ready && !refreshing}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12a9 9 0 1 1-6.2-8.55" />
          <polyline points="21 4 21 10 15 10" />
        </svg>
      </div>
      <div ref={contentRef} className="ptr-content">
        {children}
      </div>
    </div>
  );
}
