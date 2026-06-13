const cacheName = 'eminentai-pwa-v2';
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
    caches.open(cacheName).then((cache) => {
      // Use a more robust approach to caching: try each asset individually
      // so one failure doesn't break the whole service worker installation.
      return Promise.allSettled(
        appShell.map((url) => cache.add(url).catch(err => console.warn(`PWA: Failed to cache ${url}`, err)))
      );
    })
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

  const url = new URL(event.request.url);
  
  // Only handle local requests
  if (!url.origin.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const copy = response.clone();
        caches.open(cacheName).then((cache) => {
          cache.put(event.request, copy);
        });
        
        return response;
      }).catch(() => {
        // Fallback for offline if needed
        return caches.match('/');
      });
    })
  );
});
