/**
 * VRCW Service Worker — Image Cache
 * Intercepts /api/image?url=...&auth=... requests.
 * Uses a stable cache key (URL without auth param) so the browser can
 * cache avatar/world thumbnails indefinitely.
 * After first view, images NEVER hit Cloudflare again.
 */

const CACHE_NAME = 'vrcw-img-v1';
const IMAGE_PATH = '/api/image';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!url.pathname.endsWith(IMAGE_PATH) && url.pathname !== IMAGE_PATH) return;

  // Build a stable cache key — same image URL regardless of auth token
  const imageUrl = url.searchParams.get('url');
  if (!imageUrl) return;
  const stableKey = new Request(url.origin + IMAGE_PATH + '?url=' + encodeURIComponent(imageUrl));

  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      // 1. Serve from cache if available
      const cached = await cache.match(stableKey);
      if (cached) return cached;

      // 2. Fetch from network (hits Cloudflare Worker once)
      try {
        const response = await fetch(event.request);
        if (response.ok && response.status === 200) {
          // Clone before consuming, cache with stable key
          cache.put(stableKey, response.clone());
        }
        return response;
      } catch (e) {
        // Network failure — return a transparent 1x1 pixel fallback
        return new Response(
          atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
          { status: 200, headers: { 'Content-Type': 'image/gif' } }
        );
      }
    })
  );
});

// Expose a way for the app to evict old image caches
self.addEventListener('message', event => {
  if (event.data === 'clearImageCache') {
    caches.delete(CACHE_NAME).then(() => {
      event.source?.postMessage({ type: 'imageCacheCleared' });
    });
  }
});
