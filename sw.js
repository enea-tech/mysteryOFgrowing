const CACHE_NAME = 'grow420-v1';
const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    'https://fonts.googleapis.com/css2?family=Permanent+Marker&family=Orbitron:wght@400;700;900&family=Inter:wght@300;400;600;800&display=swap',
    'https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).catch(()=>{})
    );
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);
    if (url.origin !== self.location.origin) {
        e.respondWith(
            caches.match(e.request).then(cached => {
                return cached || fetch(e.request).then(response => {
                    return caches.open(CACHE_NAME).then(cache => {
                        cache.put(e.request, response.clone());
                        return response;
                    });
                });
            })
        );
        return;
    }
    if (e.request.mode === 'navigate') {
        e.respondWith(
            fetch(e.request).catch(() => caches.match('./') || caches.match(e.request))
        );
        return;
    }
    e.respondWith(
        caches.match(e.request).then(cached => {
            const fetchPromise = fetch(e.request).then(r => {
                if (r && r.status === 200) {
                    caches.open(CACHE_NAME).then(c => c.put(e.request, r.clone()));
                }
                return r;
            }).catch(() => cached);
            return cached || fetchPromise;
        })
    );
});

self.addEventListener('push', e => {
    const data = e.data ? e.data.json() : {};
    e.waitUntil(
        self.registration.showNotification(data.title || 'GROW 420', {
            body: data.body || 'Promemoria grow!',
            icon: data.icon || './icon-192.png',
            badge: data.badge || './icon-192.png',
            tag: data.tag || 'grow-reminder',
            requireInteraction: true,
            actions: data.actions || []
        })
    );
});

self.addEventListener('notificationclick', e => {
    e.notification.close();
    e.waitUntil(clients.openWindow('./'));
});
