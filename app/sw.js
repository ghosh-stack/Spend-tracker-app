// Service worker: precache the app shell so SpendLens installs and runs offline.
// The /ingest bridge is never cached (it must hit the live local server or fail
// gracefully). Bump CACHE on any shell change to invalidate old copies.
const CACHE = 'spendlens-v3';
const SHELL = [
  '.', 'index.html', 'manifest.webmanifest',
  'css/styles.css',
  'js/app.js', 'js/ui.js', 'js/db.js', 'js/ingest.js', 'js/parser.js',
  'js/rules.js', 'js/money.js', 'js/queries.js', 'js/charts.js',
  'js/lock.js', 'js/notify.js',
  'data/sample-notifications.json',
  'icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/ingest')) return; // live bridge: bypass cache

  if (e.request.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then((r) => r || fetch(e.request)));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(
      (cached) =>
        cached ||
        fetch(e.request).then((res) => {
          if (res.ok && url.origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        }).catch(() => cached)
    )
  );
});

// Focus (or open) the app when a local notification is tapped.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((cs) => {
      if (cs.length) return cs[0].focus();
      return self.clients.openWindow('.');
    })
  );
});
