// Self-destructing service worker — unregisters itself and clears all caches.
// This replaces the old Workbox SW that was breaking iOS Safari.
// When existing devices fetch /sw.js, this new version activates,
// kills itself, and the browser returns to normal fetch behavior.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll())
      .then((clients) => clients.forEach((c) => c.navigate(c.url)))
  );
});
