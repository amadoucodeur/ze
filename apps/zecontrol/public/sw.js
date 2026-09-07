const STATIC_CACHE = "zecontrol-static-v4";
const STATIC_ASSETS = [
  "/offline.html",
  "/pwa/icon-192.png",
  "/pwa/icon-512.png",
  "/pwa/icon-maskable-512.png",
  "/pwa/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(
        STATIC_ASSETS.map((url) => new Request(url, { cache: "reload" })),
      ))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys()
        .then((keys) => Promise.all(
          keys
            .filter((key) => key.startsWith("zecontrol-") && key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        )),
      self.registration.navigationPreload
        ? self.registration.navigationPreload.enable()
        : Promise.resolve(),
    ]).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const preloaded = await event.preloadResponse;
          if (preloaded) return preloaded;
          return await fetch(request);
        } catch {
          const fallback = await caches.match("/offline.html");
          return fallback || new Response("ZeControl est hors connexion.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      })(),
    );
    return;
  }

  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request)),
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || "Un rappel de pointage est disponible." };
  }
  const title = typeof payload.title === "string"
    ? payload.title
    : "Rappel ZeControl";
  const body = typeof payload.body === "string"
    ? payload.body
    : "Ouvrez ZeControl pour consulter votre pointage.";
  const url = typeof payload.url === "string"
    ? payload.url
    : "/dashboard/pointage";
  const tag = typeof payload.tag === "string"
    ? payload.tag
    : "zecontrol-reminder";

  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    lang: "fr",
    dir: "ltr",
    icon: "/pwa/icon-192.png",
    badge: "/pwa/icon-192.png",
    data: { url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  const rawTarget = event.notification.data?.url || "/dashboard/pointage";
  let targetUrl = "/dashboard/pointage";
  try {
    const parsedTarget = new URL(rawTarget, self.location.origin);
    if (parsedTarget.origin === self.location.origin) {
      targetUrl = `${parsedTarget.pathname}${parsedTarget.search}${parsedTarget.hash}`;
    }
  } catch {
    // Keep the safe pointage destination.
  }
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        for (const client of clients) {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin) {
            await client.focus();
            if ("navigate" in client) await client.navigate(targetUrl);
            return;
          }
        }
        if (self.clients.openWindow) {
          await self.clients.openWindow(targetUrl);
        }
      }),
  );
});
