// sw.js

const CACHE_NAME = 'cajitas-cache-v1.1'; // Increment version to update cache
const urlsToCache = [
  './', // Alias for index.html
  './index.html',
  './style.css?v=5', // Make sure versions match your HTML
  // Your local JavaScript files (ensure paths and versions match)
  './main.js?v=4',
  './state.js', // Add versions if you use them, e.g., state.js?v=1
  './ui.js',
  './gameLogic.js',
  './sound.js',
  './cpu.js?v=1',
  './peerjs-multiplayer.js?v=4',
  './peerConnection.js',
  './matchmaking_supabase.js',
  // Add paths to your app icons if you want to cache them
  './icons/icon-192x192.png',
  './icons/icon-512x512.png'
  // Add other essential local assets like images or fonts here if any
];

// Install event: Cache core assets
self.addEventListener('install', event => {
  console.log('[ServiceWorker] Install');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[ServiceWorker] Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .catch(err => {
        console.error('[ServiceWorker] Cache addAll failed:', err);
      })
  );
});

// Activate event: Clean up old caches
self.addEventListener('activate', event => {
  console.log('[ServiceWorker] Activate');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim(); // Take control of open clients immediately
});

// Fetch event: Serve cached content when offline
self.addEventListener('fetch', event => {
  // We only want to cache GET requests for same-origin resources
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    // For non-GET requests or cross-origin requests, bypass the cache
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }

        // Not in cache - fetch from network, cache it, then return response
        return fetch(event.request).then(
          networkResponse => {
            // Check if we received a valid response
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }

            // IMPORTANT: Clone the response. A response is a stream
            // and because we want the browser to consume the response
            // as well as the cache consuming the response, we need
            // to clone it so we have two streams.
            const responseToCache = networkResponse.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });

            return networkResponse;
          }
        ).catch(error => {
          console.error('[ServiceWorker] Fetch failed; returning offline page instead.', error);
          // Optional: return a custom offline fallback page if specific assets fail to load
          // For a single-page app, if index.html is cached, it should often work.
        });
      })
  );
});