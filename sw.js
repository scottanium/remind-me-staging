importScripts("./config.js");
const CACHE = (self.RemindMeConfig && self.RemindMeConfig.STAGING) ? "remind-me-staging-v4" : "remind-me-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./config.js",
  "./app.js",
  "./parser.js",
  "./storage.js",
  "./ics.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
        return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return cached || fetch(event.request).then(function (res) {
        return res;
      }).catch(function () {
        if (event.request.mode === "navigate") return caches.match("./index.html");
      });
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientsArr) {
      if (clientsArr.length) return clientsArr[0].focus();
      return self.clients.openWindow("./");
    })
  );
});
