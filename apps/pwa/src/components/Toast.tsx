// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";
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
  const lift = useKeyboardLift();
  if (!toast) return null;

  const colorMap = {
    success: "toast--success",
    error: "toast--error",
    info: "toast--info",
  };

  return (
    <div
      className={`toast ${colorMap[toast.type]}`}
      role="status"
      aria-live="polite"
      style={
        lift > 0
          ? { bottom: `calc(env(safe-area-inset-bottom, 0px) + 80px + ${lift}px)` }
          : undefined
      }
    >
      {toast.message}
    </div>
  );
}
