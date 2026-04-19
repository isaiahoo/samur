// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useState } from "react";
import { recordPwaInstalled } from "../services/api.js";
import { useAuthStore } from "../store/auth.js";
import { useUIStore } from "../store/ui.js";

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
const BANNER_DISMISSED_KEY = "kunak_install_banner_dismissed_at";
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
const BANNER_DISMISS_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
/** Delay after mount before the auto-show sheet becomes eligible. The
 * top banner is eligible immediately (it's small + unobtrusive);
 * this timer only applies to the full-screen nudge. */
const SHEET_DELAY_MS = 6 * 1000;

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

function dismissedRecently(key: string, cooldown: number): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < cooldown;
  } catch {
    return false;
  }
}

export interface UseInstallPromptResult {
  /** Current platform bucket — drives which body the sheet renders. */
  platform: InstallPlatform;
  /** True when the full-screen sheet should be visible (either
   * auto-triggered by the eligibility timer OR manually requested
   * via `openSheet`). */
  sheetVisible: boolean;
  /** True when the compact top banner should render. Eligible as
   * soon as we know the platform is installable — no delay, since
   * the banner is designed to live there persistently. */
  bannerVisible: boolean;
  /** For android-native only — fire the captured beforeinstallprompt. */
  triggerNative: () => Promise<void>;
  /** Open the sheet right now — skips the auto-show delay. Used by
   * the top banner's tap handler. */
  openSheet: () => void;
  /** Close the sheet without recording dismissal (manual dismiss
   * flows that shouldn't affect the banner visibility). */
  closeSheet: () => void;
  /** Record sheet dismissal (14-day cooldown). */
  dismissSheet: () => void;
  /** Record banner dismissal (3-day cooldown). The user can still
   * open the sheet via any other install CTA. */
  dismissBanner: () => void;
}

export function useInstallPrompt(): UseInstallPromptResult {
  const [platform, setPlatform] = useState<InstallPlatform>(() => detectPlatform());
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [sheetEligibleByDelay, setSheetEligibleByDelay] = useState(false);
  const [sheetManualOpen, setSheetManualOpen] = useState(false);
  const [sheetHidden, setSheetHidden] = useState<boolean>(() =>
    dismissedRecently(DISMISSED_KEY, DISMISS_COOLDOWN_MS),
  );
  const [bannerHidden, setBannerHidden] = useState<boolean>(() =>
    dismissedRecently(BANNER_DISMISSED_KEY, BANNER_DISMISS_COOLDOWN_MS),
  );
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn());
  const showToast = useUIStore((s) => s.showToast);

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

  // Fire-and-forget server notification that the current user has a
  // PWA install. Idempotent on the backend, but we also guard
  // client-side so a flurry of visibility events doesn't issue a
  // pile of requests. A celebratory toast surfaces the achievement
  // the first time it's earned (server returns alreadyInstalled=false).
  const reportInstallToServer = useCallback(() => {
    if (!isLoggedIn) return;
    try {
      const KEY = "kunak_install_reported";
      if (sessionStorage.getItem(KEY) === "1") return;
      sessionStorage.setItem(KEY, "1");
      recordPwaInstalled()
        .then((res) => {
          const data = res.data as { alreadyInstalled: boolean } | undefined;
          if (data && !data.alreadyInstalled) {
            showToast("🎉 Получено достижение «В сообществе»", "success");
          }
        })
        .catch(() => { /* best-effort */ });
    } catch { /* sessionStorage can throw in private mode */ }
  }, [isLoggedIn, showToast]);

  // If the user installs (either via our button or the browser's own
  // address-bar shortcut), kill every install surface. appinstalled is
  // a terminal event — nothing to nudge toward anymore.
  useEffect(() => {
    const onInstalled = () => {
      setSheetHidden(true);
      setBannerHidden(true);
      setSheetManualOpen(false);
      try {
        localStorage.setItem(DISMISSED_KEY, String(Date.now()));
        localStorage.setItem(BANNER_DISMISSED_KEY, String(Date.now()));
      } catch { /* ignore */ }
      setPlatform("standalone");
      reportInstallToServer();
    };
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, [reportInstallToServer]);

  // On every mount-or-login, if we're already running standalone,
  // report it. This covers (a) users who installed on another device
  // and just logged in, (b) iOS Safari users who complete the manual
  // Add-to-Home-Screen flow (which does not fire appinstalled), and
  // (c) Android users who installed from the browser's address-bar
  // icon instead of our button.
  useEffect(() => {
    if (isStandalone()) {
      setPlatform("standalone");
      reportInstallToServer();
    }
  }, [reportInstallToServer]);

  // Re-evaluate standalone on visibility change — some iOS flows swap
  // the navigator.standalone bit after returning from the Home screen
  // install confirmation.
  useEffect(() => {
    const recheck = () => {
      if (isStandalone()) {
        setPlatform("standalone");
        setSheetHidden(true);
        setBannerHidden(true);
        reportInstallToServer();
      }
    };
    document.addEventListener("visibilitychange", recheck);
    return () => document.removeEventListener("visibilitychange", recheck);
  }, [reportInstallToServer]);

  // Delay the auto-show sheet — lets the user experience the app
  // before a full-screen interrupt. Manual opens (via top-banner tap)
  // bypass this entirely through sheetManualOpen.
  useEffect(() => {
    const timer = setTimeout(() => setSheetEligibleByDelay(true), SHEET_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const dismissSheet = useCallback(() => {
    setSheetHidden(true);
    setSheetManualOpen(false);
    try { localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch { /* ignore */ }
  }, []);

  const dismissBanner = useCallback(() => {
    setBannerHidden(true);
    try { localStorage.setItem(BANNER_DISMISSED_KEY, String(Date.now())); } catch { /* ignore */ }
  }, []);

  const openSheet = useCallback(() => {
    setSheetManualOpen(true);
    // If the sheet was previously auto-dismissed, a user-initiated
    // open via the banner should re-surface it regardless.
    setSheetHidden(false);
  }, []);

  const closeSheet = useCallback(() => {
    setSheetManualOpen(false);
  }, []);

  const triggerNative = useCallback(async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        // appinstalled listener above will mark standalone; belt-and-
        // suspenders: also hide locally.
        setSheetHidden(true);
        setBannerHidden(true);
      } else {
        dismissSheet();
      }
    } catch {
      dismissSheet();
    }
    setDeferredPrompt(null);
    setPlatform((prev) => (prev === "android-native" ? "android-manual" : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredPrompt]);

  const eligibleAtAll =
    platform !== "standalone" && platform !== "desktop" && platform !== "unsupported";

  // Sheet appears when either (a) the auto-show delay elapsed and it
  // isn't on cooldown, or (b) the user tapped the banner.
  const sheetVisible =
    eligibleAtAll && (sheetManualOpen || (sheetEligibleByDelay && !sheetHidden));

  // Banner appears as soon as the platform is known to be installable;
  // no delay, but respects its own 3-day cooldown and is also hidden
  // while the sheet is open so they don't stack visually.
  const bannerVisible = eligibleAtAll && !bannerHidden && !sheetVisible;

  return {
    platform,
    sheetVisible,
    bannerVisible,
    triggerNative,
    openSheet,
    closeSheet,
    dismissSheet,
    dismissBanner,
  };
}
