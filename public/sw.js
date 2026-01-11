const CACHE_NAME = 'rubix-calc-v1';
const urlsToCache = [
    '/',
    '/build/assets/app.css',
    '/build/assets/app.js',
    'https://fonts.bunny.net/css?family=figtree:400,500,600&display=swap'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                if (response) {
                    return response;
                }
                return fetch(event.request);
            }
        )
    );
});