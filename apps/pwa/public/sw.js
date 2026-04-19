// Minimal persistent service worker.
//
// Purpose: satisfy Chrome's PWA install criteria so
// `beforeinstallprompt` fires on Android and the user gets the native
// "Установить" button in the browser address bar + our
// InstallPromptSheet's "Установить" button actually works. Chrome
// 68+ requires a registered SW with a fetch listener for the
// installability heuristic, even if the listener does nothing.
//
// Crucially, this SW does NOT call `event.respondWith()` in the
// fetch handler — the browser handles every request exactly as if
// no SW existed. No caching, no interception, no chance of
// hanging iOS Safari fetches the way the old VitePWA SW did.
//
// Registration is gated in main.tsx to non-iOS user agents. iOS
// users never get this SW installed, so there is no iOS risk here.
// Belt-and-suspenders: if iOS somehow ended up with a legacy SW
// registered, main.tsx unregisters it on every boot.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // No-op. The listener's mere existence satisfies Chrome's install
  // eligibility check; the browser fetches the request itself.
});
