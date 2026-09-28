/* 停哪裡 —— 離線快取。
   殼走 network-first(不然改版推不出去);圖磚與資料走 stale-while-revalidate。 */
var V = 'pk-20260928124549';
var SHELL = [
  './', 'index.html', 'app.css', 'app.js',
  'vendor/leaflet.js', 'vendor/leaflet.css',
  'vendor/images/marker-icon.png', 'vendor/images/marker-shadow.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'manifest.json'
];
var TILE = 'pk-tiles', DATA = 'pk-data', TILE_MAX = 400;

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(V).then(function (c) {
      // 逐條抓:一條失敗不要讓整批 addAll 掛掉
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.map(function (k) {
        return (k === V || k === TILE || k === DATA) ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
     .then(function () {
       /* 🔴 iOS 的 PWA 換版本非常黏:舊頁面會一直用舊的 shell。
          新版 SW 接管後主動通知所有開著的視窗重載一次,不然使用者要手動刪掉重裝。 */
       return self.clients.matchAll({ type: 'window' }).then(function (cs) {
         cs.forEach(function (c) { c.postMessage({ type: 'pk-updated' }); });
       });
     })
  );
});

function trim(name, max) {
  caches.open(name).then(function (c) {
    c.keys().then(function (ks) {
      if (ks.length <= max) return;
      for (var i = 0; i < ks.length - max; i++) c.delete(ks[i]);
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // 版本戳:一定要拿到最新的,不可以走快取
  if (/build\.txt$/.test(url.pathname)) return;

  // 地圖圖磚:先給快取、背景更新
  if (/tile\.openstreetmap\.org$/.test(url.hostname)) {
    e.respondWith(caches.open(TILE).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.status === 200) { c.put(req, res.clone()); trim(TILE, TILE_MAX); }
          return res;
        }).catch(function () { return hit; });
        return hit || net;
      });
    }));
    return;
  }

  // 停車資料:先走網路,失敗退快取(資料新鮮度比離線重要,App 端自己會標示)
  if (/parking-data/.test(url.pathname) || /\/data\//.test(url.pathname)) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200) caches.open(DATA).then(function (c) { c.put(req, res.clone()); });
        return res;
      }).catch(function () { return caches.open(DATA).then(function (c) { return c.match(req); }); })
    );
    return;
  }

  // 同網域的殼:network-first,離線才用快取
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200) caches.open(V).then(function (c) { c.put(req, res.clone()); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('index.html');
        });
      })
    );
  }
});
