// Service worker: permite instalar la app en el celular, abrirla sin internet (pantalla de la app)
// y recibir notificaciones push. Los datos siempre vienen en vivo de Supabase; aquí no se guardan.
const VERSION = 'cartera-v1';
const BASE = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(BASE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // Supabase y CDNs: siempre por red
  // Primero la red (para tener siempre la versión nueva); si no hay internet, lo guardado
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});

self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch { d = { titulo: e.data?.text() || 'Control de Cartera' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Control de Cartera', { body: d.cuerpo || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: d.id, data: { enlace: d.enlace || '#/inicio' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const destino = './' + (e.notification.data?.enlace || '#/inicio');
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(ws => { const w = ws[0]; if (w) { w.navigate(destino); return w.focus(); } return self.clients.openWindow(destino); }));
});
