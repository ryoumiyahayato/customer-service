const CACHE_NAME = 'customer-chat-pwa-v1';
const STATIC_ASSETS = [
  '/',
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/app-icon.svg',
  '/icons/app-icon-maskable.svg',
];

const SENSITIVE_QUERY_PATTERN = /token|session|cookie|password|secret|key|setupToken|SETUP_TOKEN|ENCRYPTION_KEY/i;

function shouldSkipCache(request) {
  const url = new URL(request.url);
  return (
    request.method !== 'GET' ||
    url.origin !== location.origin ||
    url.pathname.startsWith('/api/') ||
    url.protocol === 'ws:' ||
    url.protocol === 'wss:' ||
    Array.from(url.searchParams.keys()).some((key) => SENSITIVE_QUERY_PATTERN.test(key))
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (shouldSkipCache(request)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        return (await caches.match('/offline.html')) || caches.match('/');
      }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      });
    }),
  );
});
