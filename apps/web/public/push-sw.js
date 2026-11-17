/* Web Push handlers, loaded into the generated service worker (see workbox.importScripts). */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    const payload = event.data ? event.data.json() : {};
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) data = payload;
  } catch {
    // A payload that is not JSON still has to produce a notification.
  }
  const text = (value, fallback) => (typeof value === 'string' && value ? value : fallback);
  event.waitUntil(
    self.registration.showNotification(text(data.title, 'b*nature'), {
      body: text(data.body, ''),
      tag: text(data.tag, 'bnature'),
      renotify: true,
      icon: new URL('icon-192.png', self.registration.scope).href,
      badge: new URL('icon-192.png', self.registration.scope).href,
      data: { url: text(data.url, '/') },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Paths are app-relative; resolve them inside the scope and never leave this origin.
  const scope = self.registration.scope;
  const path = String(event.notification.data?.url ?? '/').replace(/^\/+/, '');
  let target = new URL(scope);
  try {
    const candidate = new URL(path, scope);
    if (
      candidate.origin === target.origin &&
      candidate.pathname.startsWith(target.pathname) &&
      !candidate.username &&
      !candidate.password
    )
      target = candidate;
  } catch {
    // Malformed payload URLs fall back to the app instead of losing the click.
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => client.url.startsWith(scope));
      if (open) {
        await open.focus().catch(() => undefined);
        if (open.url !== target.href) await open.navigate(target.href).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
