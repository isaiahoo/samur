// SPDX-License-Identifier: AGPL-3.0-only
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { startOutboxPolling } from "./services/outbox.js";
import { getSocket } from "./services/socket.js";
import "./index.css";

startOutboxPolling();

getSocket();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Service worker registration failed — app still works
    });
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
