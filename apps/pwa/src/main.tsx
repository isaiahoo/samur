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

// Kill any existing Service Workers
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
  caches.keys().then((keys) => {
    keys.forEach((k) => caches.delete(k));
  });
}

createRoot(document.getElementById("root")!).render(<App />);
