const VERSION = "rd-shell-v42";
const SHELL = [
  "./", "./index.html", "./styles.css?v=42", "./app.js?v=42", "./media-loader.js?v=31", "./durations.json",
  "./assets/mascot/1000022710.webp", "./assets/mascot/1000022711.webp",
  "./assets/mascot/1000022712.webp", "./assets/mascot/1000022718.webp"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request, { cache: "no-store" }).then(response => {
      const copy = response.clone();
      caches.open(VERSION).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request).then(cached => cached || caches.match("./index.html"))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(VERSION).then(cache => cache.put(event.request, copy));
    return response;
  })));
});
