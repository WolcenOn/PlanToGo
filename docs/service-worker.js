const CACHE = "plantogo-shell-v10";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=10",
  "./smart-modes.css?v=10",
  "./plan-detail.css?v=10",
  "./group-management.css?v=10",
  "./config.js?v=10",
  "./app.js?v=10",
  "./smart-modes.js?v=10",
  "./plan-detail.js?v=10",
  "./groups.js?v=10",
  "./group-management.js?v=10",
  "./manifest.json?v=10"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
