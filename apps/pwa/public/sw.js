// Self-destructing service worker — replaces any old Workbox SW,
// clears all caches, and unregisters itself.
self.addEventListener("install", function() { self.skipWaiting(); });
self.addEventListener("activate", function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(keys) { return Promise.all(keys.map(function(k) { return caches.delete(k); })); })
      .then(function() { return self.clients.matchAll(); })
      .then(function(clients) {
        // Tell all open tabs to reload cleanly (no SW interception)
        clients.forEach(function(c) { c.postMessage({ type: "SW_DESTROYED" }); });
        return self.registration.unregister();
      })
  );
});
self.addEventListener("message", function(event) {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
// Pass all fetch requests straight to network — do NOT intercept anything
self.addEventListener("fetch", function() { /* no-op: let browser handle it */ });
