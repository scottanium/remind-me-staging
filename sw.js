importScripts("./config.js");
const CACHE = (self.RemindMeConfig && self.RemindMeConfig.CACHE_NAME) || "remind-me-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./config.js",
  "./app.js",
  "./parser.js",
  "./storage.js",
  "./ics.js",
  "./speech.js",
  "./notifications.js",
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

function isOwnCacheFamily(name) {
  // Live and staging share the github.io origin, so Cache Storage is shared.
  // Only delete this copy's own family: "remind-me-staging-*" or live "remind-me-v*"
  // (never "remind-me-staging-*"). Leave every other app's caches alone.
  var staging = self.RemindMeConfig && self.RemindMeConfig.STAGING;
  var slug = (self.RemindMeConfig && self.RemindMeConfig.APP_SLUG) || "remind-me";
  if (staging) return name.indexOf(slug + "-staging-") === 0;
  return name.indexOf(slug + "-") === 0 && name.indexOf(slug + "-staging-") !== 0;
}

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k !== CACHE && isOwnCacheFamily(k);
      }).map(function (k) {
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
