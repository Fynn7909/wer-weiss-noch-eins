// Offline: Seite und Dateien beim ersten Laden merken, danach aus dem Cache.
const CACHE = 'wer-weiss-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // Seite: erst Netz (für Updates), sonst Cache. Dateien: erst Cache.
  const isPage = e.request.mode === 'navigate';
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request);
      if (hit && !isPage) return hit;
      try {
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        return hit ?? (await cache.match('./')) ?? Response.error();
      }
    }),
  );
});
