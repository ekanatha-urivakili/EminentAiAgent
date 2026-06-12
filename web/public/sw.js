const cacheName = 'eminentai-pwa-v1';
const appShell = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/brand/eminentai-mark.svg',
  '/brand/eminentai-app-icon.svg',
  '/brand/eminentai-icon-192.png',
  '/brand/eminentai-icon-512.png',
  '/brand/eminentai-wordmark-light.svg',
  '/brand/eminentai-wordmark-dark.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(cacheName).then((cache) => cache.addAll(appShell))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(cacheName).then((cache) => {
          if (response.ok && event.request.url.startsWith(self.location.origin)) {
            cache.put(event.request, copy);
          }
        });
        return response;
      });
    })
  );
});
