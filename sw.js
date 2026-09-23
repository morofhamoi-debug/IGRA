// VEXA Service Worker
const CACHE_NAME = 'vexa-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', e => {
  // пробрасываем
});

// PUSH
self.addEventListener('push', e => {
  let data = { title: 'VEXA', body: 'Новое сообщение' };
  try {
    if (e.data) data = e.data.json();
  } catch (err) {
    try { data.body = e.data.text(); } catch {}
  }

  const options = {
    body: data.body || 'Новое сообщение',
    tag: 'vexa-' + (data.chatId || Date.now()),
    renotify: true,
    data: { chatId: data.chatId, url: data.url || './' },
    vibrate: [200, 100, 200]
  };

  e.waitUntil(self.registration.showNotification(data.title || 'VEXA', options));
});

// CLICK
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const targetUrl = (e.notification.data && e.notification.data.url) || './';

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const c of clients) {
        if (c.url.includes(location.origin)) {
          c.focus();
          return;
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
