// ============================================================
// MANATI ASSET MANAGER — Service Worker
// Handles offline caching and background sync
// ============================================================

const CACHE_NAME = 'manati-assets-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=JetBrains+Mono:wght@400;500&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js'
];

// Install — cache all core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching app shell');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Removing old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch — serve from cache first, fall back to network
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Always go to network for API calls (Google Apps Script, Claude API)
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('anthropic.com') ||
      url.hostname.includes('googleapis.com')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // If API call fails offline, queue it for later
        return new Response(JSON.stringify({
          success: false,
          offline: true,
          error: 'You are offline. Data saved locally and will sync when back online.'
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // For everything else, cache-first strategy
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        // Cache successful responses for future offline use
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Offline and not in cache
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// Background sync — retry failed API calls when back online
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-assets') {
    event.waitUntil(syncPendingAssets());
  }
});

async function syncPendingAssets() {
  // This will be triggered when the device comes back online
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_READY' });
  });
}

// Listen for messages from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
