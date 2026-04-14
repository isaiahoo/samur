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

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Service worker registration failed — app still works
    });
  });

  // SW recovery: if the app is stuck (empty root after 8s), the SW is likely
  // broken (iOS Safari SW fetch bug). Unregister it and reload once.
  if (!sessionStorage.getItem("sw-recovery")) {
    setTimeout(async () => {
      const root = document.getElementById("root");
      if (root && root.children.length === 0) {
        sessionStorage.setItem("sw-recovery", "1");
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        // Clear all SW caches
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        location.reload();
      }
    }, 8000);
  }
}

document.addEventListener(
  "click",
  () => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  },
  { once: true },
);

createRoot(document.getElementById("root")!).render(<App />);
