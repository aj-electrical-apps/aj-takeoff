// Keeps AJ Takeoff on the device so it opens without internet (Jonathan 2026-10-30: "work without service").
// The page always comes from the website when there's internet (so updates arrive) and from this copy when there isn't.
// Jobs themselves are already kept in the browser; the app saves changes online when WiFi is back.
const PAGE = "aj-page", LIBS = "aj-libs";
async function keepPage() {
  try {
    const r = await fetch("/", { cache: "no-store", credentials: "same-origin" });
    if (r.ok && !r.redirected) await (await caches.open(PAGE)).put("/", r);
  } catch (e) {}
  const libs = await caches.open(LIBS);
  for (const u of ["https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"])
    try { if (!await libs.match(u)) await libs.put(u, await fetch(u, { mode: "no-cors" })); } catch (e) {}
  try { const r = await fetch("/blob-client.js", { cache: "no-store" }); if (r.ok && !r.redirected) await (await caches.open(PAGE)).put("/blob-client.js", r); } catch (e) {}
}
self.addEventListener("install", e => { e.waitUntil(keepPage()); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET") return;
  if (u.origin === location.origin) {
    if (req.mode === "navigate" && (u.pathname === "/" || u.pathname === "/index.html")) {
      e.respondWith(fetch(req).then(r => {
        if (r.ok && !r.redirected) { const c = r.clone(); caches.open(PAGE).then(x => x.put("/", c)); }
        return r;
      }).catch(async () => (await caches.match("/", { cacheName: PAGE })) || Response.error()));
    } else if (u.pathname === "/blob-client.js") {
      e.respondWith(fetch(req).then(r => { if (r.ok && !r.redirected) { const c = r.clone(); caches.open(PAGE).then(x => x.put("/blob-client.js", c)); } return r; })
        .catch(async () => (await caches.match("/blob-client.js", { cacheName: PAGE })) || Response.error()));
    }
    return;
  }
  // PDF and drawing libraries: they never change at a given address
  if (u.hostname === "cdnjs.cloudflare.com" || u.hostname === "cdn.jsdelivr.net" || u.hostname === "unpkg.com") {
    e.respondWith(caches.open(LIBS).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok || r.type === "opaque") c.put(req, r.clone());
      return r;
    }));
  }
});
