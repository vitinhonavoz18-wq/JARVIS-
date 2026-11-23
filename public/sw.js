/* Service Worker do JARVIS FV: notificações push e cache básico do app. */
// __BUILD_ID__ é substituído no build: cada deploy usa um cache novo e remove os antigos.
const CACHE = 'jarvis-__BUILD_ID__';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/index.html', '/icon.svg', '/manifest.webmanifest'])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('jarvis-') && k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Página sempre da rede (versão mais nova); cópia guardada só para uso offline.
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy));
        }
        return res;
      }).catch(() => caches.match('/index.html')),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    // Arquivos com hash no nome são imutáveis: cache primeiro; só guarda respostas válidas.
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })),
    );
  }
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'JARVIS', body: e.data && e.data.text() }; }
  const title = data.title || 'JARVIS';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || 'Você tem um lembrete.',
    tag: data.tag || undefined,
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: { url: data.url || '/' },
    renotify: false,
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
