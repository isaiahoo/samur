// SPDX-License-Identifier: AGPL-3.0-only
import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { startOutboxPolling } from "./services/outbox.js";
import { getSocket } from "./services/socket.js";
import "./i18n/index.js";
import "./index.css";

// Debug logger — writes to the visible overlay in index.html
declare global { interface Window { dbgLog?: (msg: string) => void; } }
const dbg = (msg: string) => window.dbgLog?.(msg);

dbg("main.tsx loaded");

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.2,
  });
}

try { startOutboxPolling(); dbg("outbox ok"); } catch (e) { dbg("outbox err: " + e); }
try { getSocket(); dbg("socket ok"); } catch (e) { dbg("socket err: " + e); }

// Kill any existing Service Workers
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    if (regs.length > 0) dbg("killing " + regs.length + " SWs");
    regs.forEach((r) => r.unregister());
  });
  caches.keys().then((keys) => {
    if (keys.length > 0) dbg("clearing " + keys.length + " caches");
    keys.forEach((k) => caches.delete(k));
  });
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

dbg("rendering React");
createRoot(document.getElementById("root")!).render(<App />);
dbg("React render called");
