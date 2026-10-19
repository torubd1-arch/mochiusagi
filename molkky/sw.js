// オフライン用のService Worker。
// 新しい版は待機状態にとどめ、利用者が「更新する」を押したときだけ切り替える（ゲーム中に強制リロードしない）。
// 配信ファイルを変更したら CACHE_VERSION を上げること。
const CACHE_VERSION = 'molkky-v1.0.0';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/logic.js',
  './js/setup.js',
  './js/service.js',
  './js/store.js',
  './js/format.js',
  './js/backup.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('molkky-') && k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html', { cacheName: CACHE_VERSION }).then((hit) => hit || fetch(req)),
    );
    return;
  }
  event.respondWith(
    caches.match(req, { cacheName: CACHE_VERSION, ignoreSearch: true }).then((hit) => hit || fetch(req)),
  );
});
