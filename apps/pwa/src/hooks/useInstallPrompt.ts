// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useState } from "react";

/**
 * "Add to Home Screen" nudge — platform detection + throttled display.
 *
 * Why this exists: the PWA runs fine in a mobile browser, but a
 * volunteer-aid app asked to perform in a crisis needs the icon on
 * the user's home screen. One-tap launch, full-screen (no browser
 * chrome eating the map), and — once iOS Web Push catches up fully
 * — push alerts. The browser-based UX is a demo, not a primary mode.
 *
 * Each mobile OS handles "install" differently:
 *   - Android Chrome-family fires `beforeinstallprompt`; we capture
 *     the event and call `.prompt()` when the user taps Install.
 *   - iOS Safari doesn't expose any install API; we can only render
 *     a guide that explains the Share → «На экран Домой» flow.
 *   - iOS non-Safari (Chrome, Firefox, Yandex Browser…) can't install
 *     at all because they're all WebKit; we point the user to Safari.
 *
 * Dismissal throttling: "Позже" records a timestamp in localStorage,
 * and the hook suppresses the prompt for 14 days. A hard install via
 * the native prompt fires `appinstalled` which hides the prompt
 * permanently (since display-mode will flip to standalone on next
 * launch anyway).
 */

export type InstallPlatform =
  | "standalone"       // already installed — do nothing
  | "desktop"          // skip desktop per product decision
  | "ios-safari"       // manual visual guide
  | "ios-other"        // tell user to open in Safari
  | "android-native"   // captured beforeinstallprompt — can trigger
  | "android-manual"   // Android but no captured event — show menu instructions
  | "unsupported";     // edge cases — suppress

const DISMISSED_KEY = "kunak_install_dismissed_at";
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
/** Delay after mount before the prompt becomes eligible. Lets the user
 * see that the app actually works first — interrupting on first paint
 * with an install ask is hostile. */
const DISPLAY_DELAY_MS = 20 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // All modern browsers (Android, desktop, iOS 16.4+).
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
  if (window.matchMedia("(display-mode: minimal-ui)").matches) return true;
  // Legacy iOS — pre-16.4 Safari doesn't match display-mode but exposes
  // a non-standard `standalone` property on navigator.
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function detectPlatform(): InstallPlatform {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "unsupported";
  }
  if (isStandalone()) return "standalone";

  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (
    // iPad on iOS 13+ reports as Mac; detect via touch.
    /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
  );
  const isAndroid = /Android/.test(ua);

  if (!isIOS && !isAndroid) return "desktop";

  if (isIOS) {
    // The "real" Safari on iOS is the only browser that can add to
    // home screen. Every other iOS browser is Safari-under-the-hood
    // but can't trigger the Share → Add flow from its own chrome.
    // Detect non-Safari by the vendor-prefixed UA markers each
    // embedded browser adds.
    const isNonSafari = /CriOS|FxiOS|EdgiOS|YaBrowser|OPiOS|GSA|DuckDuckGo/.test(ua);
    return isNonSafari ? "ios-other" : "ios-safari";
  }

  // Android — eligibility flips to "native" once beforeinstallprompt
  // fires. Until then we assume "manual" (user opens the browser
  // menu themselves). The hook bumps platform on event capture.
  return "android-manual";
}

function dismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_COOLDOWN_MS;
  } catch {
    return false;
  }
}

export interface UseInstallPromptResult {
  /** Current platform bucket — drives which body the sheet renders. */
  platform: InstallPlatform;
  /** True when the sheet should be visible (platform + delay +
   * dismissal window all passed). */
  visible: boolean;
  /** For android-native only — fire the captured beforeinstallprompt. */
  triggerNative: () => Promise<void>;
  /** Record dismissal and hide (14-day cooldown). */
  dismiss: () => void;
}

export function useInstallPrompt(): UseInstallPromptResult {
  const [platform, setPlatform] = useState<InstallPlatform>(() => detectPlatform());
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [eligibleByDelay, setEligibleByDelay] = useState(false);
  const [hiddenForSession, setHiddenForSession] = useState<boolean>(() => dismissedRecently());

  // Capture the Android native install prompt. Cache it — the event
  // can only be prompt()-ed once, so we hold the reference until the
  // user taps Install.
  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setPlatform((prev) =>
        prev === "android-manual" || prev === "unsupported" ? "android-native" : prev,
      );
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  // If the user installs (either via our button or the browser's own
  // address-bar shortcut), kill the prompt for the rest of the session.
  useEffect(() => {
    const onInstalled = () => {
      setHiddenForSession(true);
      try { localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch { /* ignore */ }
      setPlatform("standalone");
    };
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  // Re-evaluate standalone on visibility change — some iOS flows swap
  // the navigator.standalone bit after returning from the Home screen
  // install confirmation.
  useEffect(() => {
    const recheck = () => {
      if (isStandalone()) {
        setPlatform("standalone");
        setHiddenForSession(true);
      }
    };
    document.addEventListener("visibilitychange", recheck);
    return () => document.removeEventListener("visibilitychange", recheck);
  }, []);

  // Delay the first display — let the user experience the app before
  // interrupting with an install ask.
  useEffect(() => {
    const timer = setTimeout(() => setEligibleByDelay(true), DISPLAY_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const triggerNative = useCallback(async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        // appinstalled listener above will mark standalone; belt-and-
        // suspenders: also hide locally.
        setHiddenForSession(true);
      } else {
        dismiss();
      }
    } catch {
      // Some browsers throw if prompt() is called twice or the event
      // has gone stale. Dismiss locally so we don't loop.
      dismiss();
    }
    setDeferredPrompt(null);
    // Event is single-use — leave the platform flipped to "manual"
    // so dismiss/retry still has a sensible body to render if the
    // user got a browser error sheet instead of finishing install.
    setPlatform((prev) => (prev === "android-native" ? "android-manual" : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    setHiddenForSession(true);
    try { localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch { /* ignore */ }
  }, []);

  const shouldShow =
    eligibleByDelay &&
    !hiddenForSession &&
    platform !== "standalone" &&
    platform !== "desktop" &&
    platform !== "unsupported";

  return { platform, visible: shouldShow, triggerNative, dismiss };
}
