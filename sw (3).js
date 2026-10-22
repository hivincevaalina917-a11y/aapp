// PRINCIP — служебный файл офлайн-режима.
// Страница открывается мгновенно из памяти телефона (даже без интернета или при очень слабом),
// а свежая версия подтягивается в фоне и появится при следующем открытии.
// Данные (клиенты, замеры) хранятся отдельно — в index.html (IndexedDB) и этим файлом не затрагиваются.
const CACHE = 'princip-app-v8'; // при каждом обновлении приложения поднимайте число (v4, v5…) — старые копии на телефонах очистятся
const FILES = ['./', './index.html', './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(FILES.map((f) => c.add(f).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return; // запросы к Google не трогаем
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
