// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUIStore } from "../store/ui.js";

/** How many px of keyboard overlap the toast before we start lifting it.
 * Anything under this is small-keyboard-strip territory (e.g. the iOS
 * suggestion bar) and the baseline `bottom` is already high enough. */
const KEYBOARD_THRESHOLD_PX = 80;

/** Subscribes to visualViewport resize/scroll so the toast stays visible
 * when the on-screen keyboard pushes content up on iOS/Android. The
 * baseline `bottom` (CSS) sits above the tab-bar + safe-area; we only
 * add an extra upward translate when the keyboard visibly overlaps that
 * zone. Browsers without visualViewport support just get the baseline. */
function useKeyboardLift(): number {
  const [lift, setLift] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // How much of the layout viewport is currently hidden by the
      // keyboard. visualViewport.height shrinks when the keyboard is up;
      // offsetTop is non-zero on Android when the viewport shifts.
      const occluded = window.innerHeight - vv.height - vv.offsetTop;
      setLift(occluded > KEYBOARD_THRESHOLD_PX ? occluded : 0);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return lift;
}

export function Toast() {
  const toast = useUIStore((s) => s.toast);
  const clearToast = useUIStore((s) => s.clearToast);
  const lift = useKeyboardLift();
  const navigate = useNavigate();
  if (!toast) return null;

  const colorMap = {
    success: "toast--success",
    error: "toast--error",
    info: "toast--info",
  };

  const style = lift > 0
    ? { bottom: `calc(env(safe-area-inset-bottom, 0px) + 80px + ${lift}px)` }
    : undefined;

  // Focus-toast: clickable. Navigates to the map with `?focus=<id>&
  // markerType=<t>&lat=<n>&lng=<n>` and MapPage's URL-effect flies
  // there + highlights the marker. Keeping both the lat and lng in
  // the URL lets the map pan instantly without waiting for the socket
  // payload to round-trip through state — important if the user is
  // coming from the /alerts or /help tab (cold map).
  if (toast.focus) {
    const { id, markerType, lat, lng } = toast.focus;
    const go = () => {
      clearToast();
      const params = new URLSearchParams({
        focus: id,
        markerType,
        lat: lat.toFixed(6),
        lng: lng.toFixed(6),
      });
      navigate(`/?${params.toString()}`);
    };
    return (
      <button
        type="button"
        className={`toast toast--clickable ${colorMap[toast.type]}`}
        role="alert"
        aria-live="assertive"
        onClick={go}
        style={style}
      >
        <span className="toast-message">{toast.message}</span>
        <span className="toast-action" aria-hidden="true">
          Показать
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </span>
      </button>
    );
  }

  return (
    <div
      className={`toast ${colorMap[toast.type]}`}
      role="status"
      aria-live="polite"
      style={style}
    >
      {toast.message}
    </div>
  );
}
