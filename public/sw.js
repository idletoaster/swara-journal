const CACHE_NAME = 'swara-journal-v1.0.11';

const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/css/style.css?v=10',
    '/js/astro-engine.js?v=11',
    '/js/app.js?v=10',
    '/manifest.json',
    'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css',
    'https://npmcdn.com/flatpickr/dist/themes/dark.css',
    'https://cdn.jsdelivr.net/npm/flatpickr'
];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC_ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    if (e.request.url.includes('/api/')) {
        e.respondWith(
            fetch(e.request).catch(() => new Response(
                JSON.stringify({ offline: true }), 
                { headers: { 'Content-Type': 'application/json' } }
            ))
        );
        return;
    }
    e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});