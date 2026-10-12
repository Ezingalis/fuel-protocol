/* Fuel Protocol service worker: lets the app open with no connection.
   Your data never lives here; it stays in the page (localStorage) and syncs through /api/state. */
const VERSION = "fuel-v1";
const SHELL = ["/", "/manifest.webmanifest", "/fonts/Geist-Variable.woff2", "/icons/icon-192.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  // writes, other sites, and every API call go straight to the network: live data is never cached
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // the app page: newest copy when online, the saved copy when not
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put("/", copy)); }
          return res;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  // fonts, icons, the exercise library: serve the saved copy, refresh it in the background
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
