self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open('chat-legend-store').then((cache) => cache.addAll([
      '/',
      '/base.css',
      '/components.css',
      '/core.js',
      '/app.js',
    ])),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((response) => response || fetch(e.request)),
  );
});