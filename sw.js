// TILT offline shell. The app is a static shell over a local SQLite API, so
// the worker caches the pages, modules and icons only - never /api/ answers
// or project.json, which are state and must always come from the server.
const VERSION = 'tilt-v2';
const SHELL = [
    '/',
    '/index.html',
    '/TILT.html',
    '/manifest.webmanifest',
    '/icon-192.png',
    '/icon-512.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(VERSION)
            .then(cache => cache.addAll(SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

const isState = url => url.pathname.startsWith('/api/')
    || url.pathname === '/project.json'
    || url.pathname.startsWith('/data/')
    || url.pathname.startsWith('/__');

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin || isState(url)) return;

    // Navigations: the network wins so a fresh shell always loads, and the
    // cached page stands in when the server or the connection is gone.
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req).then(res => {
                const copy = res.clone();
                caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
                return res;
            }).catch(() => caches.match(req).then(hit => hit || caches.match('/TILT.html')))
        );
        return;
    }

    // Scripts and model data: network first. Cache-first was serving stale
    // js/*.js after every fix - the browser kept running the old app while
    // the update waited in the background. The cache only stands in when
    // the server or the connection is gone.
    if (/\.(js|json|webmanifest)$/.test(url.pathname)) {
        event.respondWith(
            fetch(req).then(res => {
                if (res && res.ok) {
                    const copy = res.clone();
                    caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
                }
                return res;
            }).catch(() => caches.match(req))
        );
        return;
    }

    // Icons and pictures: cache first, refreshed in the background.
    event.respondWith(
        caches.match(req).then(hit => {
            const fresh = fetch(req).then(res => {
                if (res && res.ok) {
                    const copy = res.clone();
                    caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
                }
                return res;
            }).catch(() => hit);
            return hit || fresh;
        })
    );
});
