// Apex Owner Desk service worker: shows call alerts and opens the phone screen when tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let msg = { title: 'Apex Owner Desk', body: 'You have a call to make', url: '/phone', tag: 'call' };
  try { msg = Object.assign(msg, event.data ? event.data.json() : {}); } catch (e) {}
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach((w) => w.postMessage({ type: 'call' }));
    await self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: msg.tag,
      renotify: true,
      requireInteraction: true,
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { url: msg.url },
      actions: msg.tag === 'test' ? [] : [{ action: 'call', title: 'Call' }],
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/phone';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).pathname.startsWith('/phone')) {
        w.postMessage({ type: 'call' });
        return w.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
