const CACHE = "plantogo-shell-v7";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=7",
  "./smart-modes.css?v=7",
  "./plan-detail.css?v=7",
  "./config.js?v=7",
  "./app.js?v=7",
  "./smart-modes.js?v=7",
  "./plan-detail.js?v=7",
  "./manifest.json?v=7"
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
