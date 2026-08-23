const CACHE_NAME = 'grow420-v4';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Permanent+Marker&family=Orbitron:wght@400;700;900&family=Inter:wght@300;400;600;800&display=swap'
];

// Install: precache shell
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: Cache-First for static, Network-First for API, stale-while-revalidate for fonts
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // API / Supabase → Network only with timeout fallback
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // Fonts & CDN → Stale While Revalidate
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com') || url.hostname.includes('cdn.jsdelivr.net')) {
    event.respondWith(
      caches.match(request).then(cached => {
        const fetchPromise = fetch(request).then(response => {
          if (response.ok) caches.open(CACHE_NAME).then(c => c.put(request, response.clone()));
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Static assets → Cache First
  event.respondWith(
    caches.match(request).then(cached => {
      return cached || fetch(request).then(response => {
        if (response.ok && request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return response;
      }).catch(() => {
        // Fallback per navigazione
        if (request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});

// Background Sync: queue reminders and logs
self.addEventListener('sync', event => {
  if (event.tag === 'grow-sync') {
    event.waitUntil(syncGrowData());
  }
});

async function syncGrowData() {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => client.postMessage({ type: 'SYNC_REQUIRED' }));
}

// Push notifications (placeholder for future expansion)
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : { title: 'GROW 420', body: 'Promemoria grow' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'assets/icon-192.png',
      badge: 'assets/icon-72.png',
      tag: data.tag || 'grow-reminder',
      requireInteraction: true
    })
  );
});
