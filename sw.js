const CACHE = "lnjpit-connect-v13";
const SHELL = [
  "./",
  "./index.html",
  "./404.html",
  "./manifest.webmanifest",
  "./firebase-messaging-sw.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// Register notification click handler before loading FCM so the SDK cannot
// override the app's navigation behavior. Resolves relative paths from worker
// scope to support both Firebase Hosting and GitHub Pages project URLs.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const rawUrl = event.notification.data?.url || "./";
  const targetUrl = new URL(rawUrl, self.registration.scope).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
      for (const client of windows) {
        if (client.url.startsWith(self.registration.scope) && "focus" in client) {
          const navPromise = "navigate" in client
            ? client.navigate(targetUrl).catch(() => client)
            : Promise.resolve(client);
          return navPromise.then(() => client.focus());
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Load Firebase compat SDK resiliently so offline service-worker installation
// never crashes if the CDN is temporarily unreachable.
let messaging = null;
try {
  importScripts("https://www.gstatic.com/firebasejs/13.0.0/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/13.0.0/firebase-messaging-compat.js");

  firebase.initializeApp({
    apiKey: "AIzaSyD1VQ6LxMrKaMl0AuxEA9mRc1SpdDopck4",
    authDomain: "lnjpit-timetable.firebaseapp.com",
    projectId: "lnjpit-timetable",
    storageBucket: "lnjpit-timetable.firebasestorage.app",
    messagingSenderId: "983687695923",
    appId: "1:983687695923:web:de769b16368a1a34d51d46"
  });

  messaging = firebase.messaging();

  // Notification payloads are shown by FCM automatically in the background.
  // This handler supplies a visible notification for data-only messages.
  messaging.onBackgroundMessage(payload => {
    if (payload?.notification?.title) return;
    const data = payload?.data || {};
    return self.registration.showNotification(data.title || "LNJPIT Connect", {
      body: data.body || "You have an upcoming class reminder.",
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      tag: data.reminderId || "lnjpit-connect",
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: data.url || "./" }
    });
  });
} catch (error) {
  console.warn("[SW] Firebase Messaging unavailable offline; offline caching remains active.", error);
}

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Network-first strategy with smart offline fallback
self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) return;

  const isNavigation = request.mode === "navigate" ||
    (request.headers.get("accept") || "").includes("text/html");

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: isNavigation });
        if (cached) return cached;
        if (isNavigation) {
          return (await caches.match("./index.html")) || (await caches.match("./"));
        }
        return new Response("Offline", { status: 503, statusText: "Offline" });
      })
  );
});
