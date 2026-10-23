// Offline support. The app's own files and the bass samples are cached on install;
// the libraries and fonts from the CDNs are cached the first time they load.
// Bump VERSION whenever you deploy so phones pick up the new files.
const VERSION = 'bassline-builder-v6';

const APP = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/main.js',
  'js/state.js',
  'js/theory.js',
  'js/grid.js',
  'js/controls.js',
  'js/audio.js',
  'js/fingering.js',
  'js/notation.js',
  'js/genres.js',
  'js/coach.js',
  'js/share.js',
  'js/export.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  ...['Cs1', 'E1', 'G1', 'As1', 'Cs2', 'E2', 'G2', 'As2', 'Cs3', 'E3', 'G3', 'As3'].map(n => `samples/bass/${n}.mp3`),
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Serve from the cache straight away and refresh it in the background.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const cacheable = url.origin === location.origin || /(^|\.)(jsdelivr\.net|googleapis\.com|gstatic\.com)$/.test(url.hostname);
  if (!cacheable) return;
  event.respondWith(
    caches.open(VERSION).then(async cache => {
      const hit = await cache.match(req, { ignoreSearch: url.origin === location.origin });
      const refresh = fetch(req)
        .then(res => {
          if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit ?? refresh;
    })
  );
});
