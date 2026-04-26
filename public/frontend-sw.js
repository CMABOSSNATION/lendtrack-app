// sw.js — LendTrack Service Worker
// Handles: app shell caching, offline fallback, background sync queue

const CACHE_NAME = "lendtrack-v1";
const SYNC_TAG = "lendtrack-sync";

// App shell files to cache on install
const SHELL_URLS = [
  "/",
  "/index.html",
];

// ── Install: cache app shell ──────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

// ── Activate: clear old caches ────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first for API, cache-first for assets ─────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API calls: network only (offline queuing handled in app via IndexedDB)
  if (url.pathname.startsWith("/api") || url.hostname !== self.location.hostname) {
    event.respondWith(fetch(event.request).catch(() =>
      new Response(JSON.stringify({ error: "offline" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      })
    ));
    return;
  }

  // App shell: cache-first with network fallback → serve index.html for SPA routes
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((res) => {
          // Cache successful responses (JS/CSS/fonts)
          if (res.ok && res.type !== "opaque") {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match("/index.html")); // SPA fallback
    })
  );
});

// ── Background sync: replay queued offline mutations ─────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(replayQueue());
  }
});

async function replayQueue() {
  // Notify all clients to trigger their own sync (they have the token + IDB access)
  const clients = await self.clients.matchAll({ type: "window" });
  clients.forEach((c) => c.postMessage({ type: "SW_SYNC" }));
}
