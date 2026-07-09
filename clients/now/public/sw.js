// Service worker: enables installability (PWA) + real Web Push, same
// mechanism as the older BECOME prototype (see repo history) -- listens
// for push events from the engine's web-push delivery and shows a real OS
// notification, which is what makes this show up in the browser/OS's own
// per-site notification settings instead of just a page-visible toast.
self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

// A no-op passthrough, but its presence matters: Chrome's installability
// check (what actually enables "Add to Home Screen" / its own Android
// notification-settings entry, not just a browser-tab permission) has
// historically required the service worker to handle `fetch`, not just
// `push` -- a push-only worker like this one previously had can be
// registered and active while still not counting as installable.
self.addEventListener('fetch', function (e) {
  e.respondWith(fetch(e.request));
});

self.addEventListener('push', function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) {}
  var title = data.title || 'NOW';
  var body = data.body || "What's the smallest useful thing right now?";
  e.waitUntil(self.registration.showNotification(title, {
    body: body,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: 'now-checkin',
    renotify: true,
    data: { url: './' },
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if ('focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
