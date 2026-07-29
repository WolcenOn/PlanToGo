const CACHE = "plantogo-shell-v33";
const ASSETS = [
  "./", "./index.html", "./styles.css?v=12", "./smart-modes.css?v=12",
  "./plan-detail.css?v=12", "./group-management.css?v=31",
  "./dashboard-refinement.css?v=30", "./groups-page.css?v=30",
  "./calendar-day-page.css?v=30", "./task-subtasks.css?v=30",
  "./event-wizard.css?v=14", "./recurrence-pages.css?v=14",
  "./config.js?v=12", "./app.js?v=12", "./smart-modes.js?v=16",
  "./plan-detail.js?v=12", "./groups.js?v=12", "./group-management.js?v=31",
  "./event-wizard.js?v=14", "./recurrence-ui.js?v=21",
  "./recurrence-form-fix.js?v=18", "./recurrence-editor-fix.js?v=15",
  "./event-sharing.js?v=24", "./group-invitations.js?v=24",
  "./fixed-date-submit-fix.js?v=25", "./activity-date-controls.js?v=33",
  "./dashboard-refinement.js?v=30", "./groups-page.js?v=30",
  "./calendar-day-page.js?v=30", "./task-subtasks.js?v=30",
  "./event-wizard-layout-fix.js?v=13", "./pwa-install.js?v=31",
  "./manifest.json?v=31", "./icons/plantogo-icon.svg"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});