/* Fuel Protocol service worker: lets the app open with no connection.
   Your data never lives here; it stays in the page (localStorage) and syncs through /api/state. */
const VERSION = "fuel-v2";
const MEDIA = "fuel-media"; // demo clips the user chose to save; kept across app updates
const LIBC = "fuel-lib";     // exercise library photos, kept as they're seen (or all at once); kept across updates
const SHELL = ["/", "/manifest.webmanifest", "/fonts/Geist-Variable.woff2", "/icons/icon-192.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== MEDIA && k !== LIBC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  // writes, other sites, and every API call go straight to the network: live data is never cached
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // demo clips: a saved copy if there is one (cut to the byte range the video player asks for),
  // otherwise the network. Thumbnails are small, so they're kept as they're seen.
  if (url.pathname.startsWith("/media/")) {
    e.respondWith(fromMedia(req, url));
    return;
  }

  // library photos: small and they never change, so a saved copy wins and a new one is kept
  if (url.pathname.startsWith("/lib/")) {
    e.respondWith(caches.open(LIBC).then((c) => c.match(url.pathname).then((hit) => hit || fetch(req).then((res) => {
      if (res.status === 200) c.put(url.pathname, res.clone());
      return res;
    }))));
    return;
  }

  // the app page: the newest copy if the network answers within 3 s, else the saved copy.
  // A gym with one bar of signal hangs rather than fails, so waiting on it isn't an option.
  if (req.mode === "navigate") {
    const net = fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put("/", copy)); }
      return res;
    });
    e.respondWith(
      Promise.race([net.catch(() => null), new Promise((r) => setTimeout(r, 3000, null))])
        .then((res) => res || caches.match("/").then((hit) => hit || net))
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

async function fromMedia(req, url) {
  const cache = await caches.open(MEDIA);
  const hit = await cache.match(url.pathname);
  if (hit) return req.headers.get("range") ? sliced(hit, req.headers.get("range")) : hit;
  const res = await fetch(req);
  if (res.status === 200 && url.pathname.endsWith(".jpg")) cache.put(url.pathname, res.clone());
  return res;
}

async function sliced(res, range) {
  const buf = await res.arrayBuffer(), size = buf.byteLength;
  const r = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!r || (!r[1] && !r[2])) return new Response(buf, { status: 200, headers: { "Content-Type": res.headers.get("Content-Type") || "video/mp4", "Accept-Ranges": "bytes" } });
  const start = r[1] === "" ? Math.max(0, size - Number(r[2])) : Number(r[1]);
  const end = r[1] === "" || r[2] === "" ? size - 1 : Math.min(Number(r[2]), size - 1);
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
  return new Response(buf.slice(start, end + 1), { status: 206, headers: {
    "Content-Type": res.headers.get("Content-Type") || "video/mp4",
    "Content-Range": "bytes " + start + "-" + end + "/" + size,
    "Content-Length": String(end - start + 1),
    "Accept-Ranges": "bytes"
  } });
}

/* reminders (see push.js): the push carries no message, so ask the server what to say */
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let d = {};
    try {
      const r = await fetch("/api/push/pending", { credentials: "same-origin", cache: "no-store" });
      if (r.ok) d = await r.json();
    } catch (err) { /* the general message is fine */ }
    const url = /^\/\?open=[\w:]+$/.test(d.url || "") ? d.url : "/";
    await self.registration.showNotification(d.title || "Fuel", {
      body: d.body || "Tap to open Fuel.", tag: url, renotify: true, icon: "/icons/icon-192.png", data: { url }
    });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const url = (e.notification.data && e.notification.data.url) || "/", open = (url.split("open=")[1] || "");
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) { w.postMessage({ open }); return w.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
