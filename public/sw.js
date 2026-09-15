const CACHE = "painel-jb-render-notas-v8";
const SHELL = ["/", "/styles.css?v=notas-8", "/app.js?v=notas-8", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
  ));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || event.request.url.includes("/api/")) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("/"))));
});

self.addEventListener("push", (event) => {
  const data = event.data?.json() || { title: "Meu Painel JB", body: "Você tem um lembrete." };
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: "/icon-192.png", badge: "/icon-192.png",
    data: { url: data.url || "/" }, tag: "painel-jb-reminder",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const open = windows.find((windowClient) => "focus" in windowClient);
    return open ? open.focus() : clients.openWindow(event.notification.data?.url || "/");
  }));
});
