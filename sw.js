const CACHE_NAME = 'grow420-v2';

// Risorse esterne (font, librerie) precaricate all'installazione
const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    'https://fonts.googleapis.com/css2?family=Permanent+Marker&family=Orbitron:wght@400;700;900&family=Inter:wght@300;400;600;800&display=swap',
    'https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// Tutte le immagini locali del sito (sfondi pagine, stadi pianta, icone fasi, joint,
// icone PWA). Precaricate all'installazione così OGNI pagina funziona offline dal
// primo avvio, anche se quella pagina non è mai stata aperta online prima.
const LOCAL_ASSETS = [
    'assets/logo.jpg',
    'assets/bg-home.jpg',
    'assets/bg-library.jpg',
    'assets/art1.jpg', 'assets/art2.jpg', 'assets/art3.jpg', 'assets/art4.jpg',
    'assets/art5.jpg', 'assets/art6.jpg', 'assets/art7.jpg',
    'assets/stage0.png', 'assets/stage1.png', 'assets/stage2.png',
    'assets/stage3.png', 'assets/stage4.png', 'assets/stage5.png',
    'assets/bud-pixel-1.png', 'assets/bud-pixel-2.png', 'assets/bud-pixel-3.png',
    'assets/joint.png', 'assets/alienjoint.png',
    'assets/01_Setup.png', 'assets/02_Germinazione.png', 'assets/03_Seedling.png',
    'assets/04_Vegetativa.png', 'assets/05_Pre-Fioritura.png', 'assets/06_Fioritura.png',
    'assets/07_Flushing.png', 'assets/08_Raccolta.png', 'assets/09_Essiccazione.png',
    'assets/10_Curing.png',
    './icon-192.png',
    './icon-512.png'
];

// Domini che NON devono mai passare dalla cache: le chiamate cloud (Supabase) devono
// sempre andare in rete, altrimenti la sync da/verso il cloud mostra errori falsi
// oppure resta bloccata sulla prima risposta salvata per sempre.
const NEVER_CACHE_HOSTS = ['supabase.co'];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            await cache.addAll(STATIC_ASSETS).catch(() => {});
            // Ogni immagine viene richiesta singolarmente: se una manca o dà errore
            // non blocca il caching di tutte le altre (niente install "tutto o niente").
            await Promise.all(LOCAL_ASSETS.map(url =>
                fetch(url).then(r => {
                    if (r && r.ok) return cache.put(url, r);
                }).catch(() => {})
            ));
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    const req = e.request;
    const url = new URL(req.url);

    // Chiamate verso Supabase: mai intercettate, sempre rete fresca.
    if (NEVER_CACHE_HOSTS.some(h => url.hostname.endsWith(h))) {
        return;
    }

    // La Cache API può salvare solo richieste GET: qualsiasi altro metodo
    // (POST/PUT/PATCH/DELETE) deve passare intatto, senza essere intercettato.
    if (req.method !== 'GET') {
        return;
    }

    // Navigazione (apertura/refresh pagina): prova la rete, altrimenti la cache.
    if (req.mode === 'navigate') {
        e.respondWith(
            fetch(req).catch(async () => {
                const cachedRoot = await caches.match('./');
                if (cachedRoot) return cachedRoot;
                const cachedIndex = await caches.match('./index.html');
                return cachedIndex || Response.error();
            })
        );
        return;
    }

    // Risorse esterne (font, librerie CDN): cache-first, aggiornate in background.
    if (url.origin !== self.location.origin) {
        e.respondWith(
            caches.match(req).then(cached => {
                const network = fetch(req).then(r => {
                    if (r && r.ok) caches.open(CACHE_NAME).then(c => c.put(req, r.clone()));
                    return r;
                }).catch(() => cached);
                return cached || network;
            })
        );
        return;
    }

    // Risorse dello stesso dominio (immagini, script, ecc.): cache-first,
    // aggiornate in background per restare sempre coerenti.
    e.respondWith(
        caches.match(req).then(cached => {
            const network = fetch(req).then(r => {
                if (r && r.ok) caches.open(CACHE_NAME).then(c => c.put(req, r.clone()));
                return r;
            }).catch(() => cached);
            return cached || network;
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
