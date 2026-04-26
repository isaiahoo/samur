// Minimal persistent service worker with legacy-Workbox recovery.
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
// On activate we ALSO wipe every cache the browser has for this
// origin. This is the recovery path for users whose PWA was first
// installed back when the build still shipped a VitePWA Workbox SW
// — those devices have `workbox-precache-v2-*` caches full of stale
// asset hashes that no longer exist on the server, and Workbox's
// fetch handler kept serving the dead URLs until the cache was
// cleared. After this activate runs once, the device is clean and
// future requests bypass the SW entirely.
//
// If we detect that the activate actually had something to clear
// (i.e. we just replaced an older SW), we force every open page to
// reload itself so the user lands on fresh assets without having to
// swipe-kill the app manually.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));

    await self.clients.claim();

    // Only reload when we actually cleaned something up — fresh
    // installs see keys.length === 0 and skip the reload, no flash.
    if (keys.length > 0) {
      const windows = await self.clients.matchAll({ type: "window" });
      for (const client of windows) {
        try { client.navigate(client.url); } catch { /* best effort */ }
      }
    }
  })());
});

self.addEventListener("fetch", () => {
  // No-op. The listener's mere existence satisfies Chrome's install
  // eligibility check; the browser fetches the request itself.
});
