const CACHE_NAME = 'conectafemme-shell-v9';
const APP_SHELL = [
  '/',
  '/index.html',
  '/conheca.html',
  '/manifest.webmanifest',
  '/style.css',
  '/admin-updates.css',
  '/conheca.css',
  '/app.js',
  '/supabase-config.js',
  '/assets/conectafemme-logo.png',
  '/assets/pwa-icon-192.png',
  '/assets/pwa-icon-512.png'
];
const STATIC_PATHS = new Set(APP_SHELL.filter((path) => path !== '/' && path !== '/index.html' && path !== '/conheca.html'));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('conectafemme-shell-') && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/_vercel/') || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        const cachedPage = await caches.match(request);
        return cachedPage || await caches.match('/index.html') || new Response('ConectaFemme indisponível offline.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  if (STATIC_PATHS.has(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const update = fetch(request).then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      }).catch(() => null);
      return cached || await update || new Response('', { status: 503 });
    })());
  }
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = typeof payload.title === 'string' ? payload.title : 'ConectaFemme';
  const options = {
    body: typeof payload.body === 'string' ? payload.body : 'Você tem uma nova atualização.',
    icon: '/assets/pwa-icon-192.png',
    badge: '/assets/pwa-icon-192.png',
    data: { url: typeof payload.url === 'string' ? payload.url : '/' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    let target = new URL('/', self.location.origin);
    try {
      const candidate = new URL(event.notification.data && event.notification.data.url || '/', self.location.origin);
      if (candidate.origin === self.location.origin) target = candidate;
    } catch {
      // Keep the default same-origin destination.
    }

    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(target.href);
      return existing.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
