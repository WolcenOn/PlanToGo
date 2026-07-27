const CACHE = "plantogo-shell-v12";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=12",
  "./smart-modes.css?v=12",
  "./plan-detail.css?v=12",
  "./group-management.css?v=12",
  "./event-wizard.css?v=12",
  "./recurrence-pages.css?v=12",
  "./config.js?v=12",
  "./app.js?v=12",
  "./smart-modes.js?v=12",
  "./plan-detail.js?v=12",
  "./groups.js?v=12",
  "./group-management.js?v=12",
  "./event-wizard.js?v=12",
  "./recurrence-ui.js?v=12",
  "./recurrence-editor-fix.js?v=12",
  "./manifest.json?v=12"
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
