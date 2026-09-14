// Generated into public/deutsch-woerter/sw.js by scripts/build-vocab-data.mjs.
// CACHE is stamped with a hash of the files it caches, so every deploy that
// changes an asset also changes this file, which is what makes the browser pick
// the update up. Nothing in here is version-bumped by hand.
const CACHE = "deutsch-woerter-__BUILD_ID__";
const ASSETS = __ASSETS__;

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Individually, not addAll: one asset failing used to abort the whole
    // install and leave the app with no offline support at all.
    const results = await Promise.allSettled(ASSETS.map(a => cache.add(a)));
    const failed = results.filter(r => r.status === "rejected").length;
    if (failed) console.warn(`[sw] ${failed}/${ASSETS.length} assets missed the precache`);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE && k !== "deutsch-woerter-audio").map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", e => {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  if (e.request.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const r = await fetch(e.request);
        const cache = await caches.open(CACHE);
        cache.put("./index.html", r.clone());
        return r;
      } catch {
        return (await caches.match("./index.html")) || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    if (cached) return cached;
    const r = await fetch(e.request);
    if (r && r.ok) {
      const cache = await caches.open(CACHE);
      cache.put(e.request, r.clone());
    }
    return r;
  })());
});
