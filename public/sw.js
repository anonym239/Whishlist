// Service Worker: macht die Seite installierbar und öffnet sie auch ohne Internet
const CACHE = 'wunschliste-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Immer zuerst aus dem Netz laden (damit Updates sofort da sind), nur offline aus dem Cache
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.pathname.startsWith('/api')) return; // Daten nie cachen
  e.respondWith(fetch(r).then(res => {
    if (res.ok && (u.origin === location.origin || u.hostname === 'cdnjs.cloudflare.com')) {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(r.mode === 'navigate' ? '/index.html' : r, copy));
    }
    return res;
  }).catch(() => caches.match(r.mode === 'navigate' ? '/index.html' : r)));
});
