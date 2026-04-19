// SPDX-License-Identifier: AGPL-3.0-only
import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { startOutboxPolling } from "./services/outbox.js";
import { getSocket } from "./services/socket.js";
import "./i18n/index.js";
import "./index.css";

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.2,
  });
}

startOutboxPolling();
getSocket();

// Service worker registration — Android gets a no-op SW so Chrome's
// installability heuristic fires (beforeinstallprompt + address-bar
// install button); iOS stays SW-free because legacy Workbox SWs hung
// iOS Safari fetches on repeat visits. UA detection is reliable
// enough for this gate — even if a user spoofs their UA, the worst
// case on iOS is the no-op SW installs and does nothing (no fetch
// interception = no hang).
if ("serviceWorker" in navigator) {
  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  if (isIOS) {
    // Defence in depth — if a legacy SW is still registered from the
    // pre-cleanup era, unregister it and clear any caches it left.
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    });
    caches.keys().then((keys) => {
      keys.forEach((k) => caches.delete(k));
    });
  } else {
    // Android + desktop: register the no-op SW so Chrome considers
    // the site installable. Silent on failure — if registration
    // errors, we lose the native install prompt but the manual
    // instructions in InstallPromptSheet still work.
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* silent */
    });
  }
}

createRoot(document.getElementById("root")!).render(<App />);
