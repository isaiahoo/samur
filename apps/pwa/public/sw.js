// Self-destructing service worker — unregisters itself and clears all caches.
// Replaces the old Workbox SW that was breaking iOS Safari.
self.addEventListener("install", function() { self.skipWaiting(); });
self.addEventListener("activate", function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(keys) { return Promise.all(keys.map(function(k) { return caches.delete(k); })); })
      .then(function() { return self.registration.unregister(); })
  );
});
// Pass all fetch requests straight to network — do NOT intercept anything
self.addEventListener("fetch", function() { /* no-op: let browser handle it */ });
