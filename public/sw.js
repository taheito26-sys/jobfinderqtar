// Minimal pass-through service worker (keeps the app installable).
// It never intercepts requests, so it cannot break page loads; it also clears any old caches.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', () => {});
