/* 車位 —— 北北桃停車位。資料來自各市政府開放資料,由樹莓派每 10 分鐘聚合後發佈。 */
(function () {
  'use strict';

  var DATA_BASE = 'https://dominiclu82.github.io/parking-data/data/';
  var HOME = { lat: 25.0777, lon: 121.2328, z: 14 };   // 預設:桃園機場
  var MAX_PINS = 260;          // 同時畫在地圖上的上限,超過會卡
  var LS = { data: 'pk.data', meta: 'pk.meta', at: 'pk.at', me: 'pk.me' };

  var P = [], META = null, map = null, layer = null, meMarker = null;
  var sel = null, picking = false, sortMode = 'dist';
  var sheetState = 'peek';   // peek | half | full | off
  var beforeDetail = 'peek';  // 開詳情前面板展開到哪,關掉要回去
  var filterAvail = 'free', filterKind = 'all';
  var me = { lat: HOME.lat, lon: HOME.lon, real: false };
  var markers = [];

  // ---------- 小工具 ----------
  function $(id) { return document.getElementById(id); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, ms || 2600);
  }
  function dist(a1, o1, a2, o2) {
    var R = 6371000, t = Math.PI / 180;
    var dA = (a2 - a1) * t, dO = (o2 - o1) * t;
    var x = Math.sin(dA / 2) * Math.sin(dA / 2) +
            Math.cos(a1 * t) * Math.cos(a2 * t) * Math.sin(dO / 2) * Math.sin(dO / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  function fmtD(m) { return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km'; }
  function walk(m) { return Math.max(1, Math.round(m / 80)) + ' 分'; }

  /* av 為 null 代表「來源沒有提供這項資料」,不是 0 —— 絕不可顯示成 0。 */
  function cls(p) {
    if (p.av == null) return 'unk';
    if (p.av === 0) return 'zero';
    if (p.tot && p.av / p.tot < 0.12) return 'tight';
    return 'free';
  }
  function feeTxt(p) {
    if (!p.fk) return null;
    if (p.fk === 'free') return '免費';
    var u = p.fk === 'hour' ? '/時' : '/次';
    return (p.f1 === p.f2 ? p.f1 : p.f1 + '–' + p.f2) + ' 元' + u;
  }
  function feeShort(p) {
    if (!p.fk) return null;
    if (p.fk === 'free') return '免費';
    return '$' + p.f1 + (p.f1 !== p.f2 ? '+' : '');
  }
  function feeKey(p) {
    if (!p.fk) return 1e9;
    if (p.fk === 'free') return -1;
    return p.fk === 'hour' ? p.f1 : p.f1 * 0.5;
  }

  // ---------- 資料 ----------
  function applyData(items, meta, cached) {
    P = items || [];
    META = meta || null;
    renderStale(cached);
    refreshPins();
    renderList();
  }

  function loadCache() {
    var d = lsGet(LS.data);
    if (!d) return false;
    try {
      applyData(JSON.parse(d), JSON.parse(lsGet(LS.meta) || 'null'), true);
      return true;
    } catch (e) { return false; }
  }

  function fetchFresh() {
    var bust = '?t=' + Math.floor(Date.now() / 60000);
    return Promise.all([
      fetch(DATA_BASE + 'parking.json' + bust).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
      }),
      fetch(DATA_BASE + 'meta.json' + bust).then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
    ]).then(function (res) {
      if (!Array.isArray(res[0]) || res[0].length < 100) throw new Error('資料異常');
      lsSet(LS.data, JSON.stringify(res[0]));
      lsSet(LS.meta, JSON.stringify(res[1]));
      lsSet(LS.at, String(Date.now()));
      applyData(res[0], res[1], false);
    });
  }

  /* 資料新鮮度要照實講:離線用舊資料、或某個來源掛掉用了快取,都要讓使用者看到。 */
  function renderStale(cached) {
    var el = $('stale'), msgs = [];
    if (cached) {
      var at = parseInt(lsGet(LS.at) || '0', 10);
      var mins = at ? Math.round((Date.now() - at) / 60000) : null;
      msgs.push(mins == null ? '離線:顯示先前存下的資料'
                             : '離線:資料是 ' + (mins < 60 ? mins + ' 分鐘前' : Math.round(mins / 60) + ' 小時前') + '的');
    }
    if (META && META.sources) {
      var bad = [];
      var NAME = { taipei: '台北', ntpc_lot: '新北停車場', ntpc_street: '新北路邊', taoyuan: '桃園' };
      Object.keys(META.sources).forEach(function (k) {
        var s = META.sources[k];
        if (!s.ok) {
          bad.push(NAME[k] || k + (s.stale ? '(' + s.ageMin + ' 分前)' : '(無資料)'));
        }
      });
      if (bad.length) msgs.push('這些來源沒抓到最新:' + bad.join('、'));
    }
    if (msgs.length) { el.textContent = '⚠︎ ' + msgs.join(' · '); el.hidden = false; }
    else el.hidden = true;
  }

  // ---------- 地圖 ----------
  function initMap() {
    var saved = null;
    try { saved = JSON.parse(lsGet(LS.me) || 'null'); } catch (e) {}
    if (saved && saved.lat) me = { lat: saved.lat, lon: saved.lon, real: false };

    map = L.map('map', { zoomControl: false, attributionControl: true, tap: true })
           .setView([me.lat, me.lon], HOME.z);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, minZoom: 9,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    layer = L.layerGroup().addTo(map);

    meMarker = L.marker([me.lat, me.lon], {
      icon: L.divIcon({ className: '', html: '<div class="me" style="width:16px;height:16px"></div>',
                        iconSize: [16, 16], iconAnchor: [8, 8] }),
      zIndexOffset: 1000, interactive: false
    }).addTo(map);

    map.on('moveend zoomend', refreshPins);
    map.on('click', function (e) {
      if (picking) { setMe(e.latlng.lat, e.latlng.lng, false); setPicking(false); }
      else { closeSheet(); }
    });
  }

  function setMe(lat, lon, real) {
    me = { lat: lat, lon: lon, real: !!real };
    lsSet(LS.me, JSON.stringify({ lat: lat, lon: lon }));
    if (meMarker) meMarker.setLatLng([lat, lon]);
    refreshPins();
    renderList();
  }
  function setPicking(on) {
    picking = on;
    $('pickHint').hidden = !on;
    $('locBtn').classList.toggle('on', on);
  }

  function visible() {
    if (!map || !P.length) return [];
    var b = map.getBounds(), out = [];
    for (var i = 0; i < P.length; i++) {
      var p = P[i];
      if (filterKind !== 'all' && p.k !== filterKind) continue;
      if (filterAvail === 'free' && !(p.av > 0)) continue;
      if (p.lat < b.getSouth() || p.lat > b.getNorth() ||
          p.lon < b.getWest()  || p.lon > b.getEast()) continue;
      out.push(p);
    }
    out.sort(function (a, b2) { return (b2.av == null ? -1 : b2.av) - (a.av == null ? -1 : a.av); });
    return out;
  }

  function refreshPins() {
    if (!map) return;
    layer.clearLayers(); markers = [];
    var z = map.getZoom(), list = visible(), n = Math.min(list.length, MAX_PINS);
    var mode = z < 14 ? 'dot' : (z < 16 ? 'one' : 'two');
    for (var i = 0; i < n; i++) {
      var p = list[i], k = cls(p), html, w, h;
      if (mode === 'dot') {
        var r = k === 'unk' ? 8 : Math.min(20, 9 + Math.sqrt(Math.max(0, p.av || 0)) * 1.6);
        html = '<div class="dot' + (p === sel ? ' sel' : '') + '" style="width:' + r + 'px;height:' + r +
               'px;background:var(--' + (k === 'zero' ? 'full' : k === 'unk' ? 'unknown' : k) + ')"></div>';
        w = r; h = r;
      } else {
        var f = feeShort(p) || '—';
        var two = mode === 'two';
        html = '<div class="pin ' + k + (p === sel ? ' sel' : '') + '"><span class="p1">' + esc(f) + '</span>' +
               (two ? '<span class="p2">' + (p.av == null ? '未知' : p.av + ' 位') + '</span>' : '') + '</div>';
        w = Math.max(38, String(f).length * 8 + 14); h = two ? 32 : 22;
      }
      var m = L.marker([p.lat, p.lon], {
        icon: L.divIcon({ className: '', html: html, iconSize: [w, h], iconAnchor: [w / 2, h / 2] })
      });
      (function (pp) { m.on('click', function (ev) { L.DomEvent.stop(ev); openSheet(pp); }); })(p);
      m.addTo(layer); markers.push(m);
    }
    if (list.length > MAX_PINS && z >= 14) {
      // 只畫得下一部分時要說出來,不要讓使用者以為就只有這些
      $('pickHint').hidden = picking ? false : true;
    }
  }

  // ---------- 詳情 ----------
  function navUrls(p) {
    var ll = p.lat.toFixed(6) + ',' + p.lon.toFixed(6);
    return {
      apple: 'https://maps.apple.com/?daddr=' + ll + '&dirflg=d',
      google: 'https://www.google.com/maps/dir/?api=1&destination=' + ll + '&travelmode=driving'
    };
  }
  function openSheet(p) {
    if (sheetState !== 'off') beforeDetail = sheetState;
    setSheet('off');
    sel = p; refreshPins();
    var k = cls(p), d = dist(me.lat, me.lon, p.lat, p.lon), u = navUrls(p), ft = feeTxt(p);
    var av = p.av == null ? '<span class="n">未知</span><div class="t">來源未提供</div>'
           : '<span class="n">' + p.av + '</span><div class="t">' + (p.tot ? '共 ' + p.tot + ' 位' : '空位') + '</div>';
    $('sheetBody').innerHTML =
      '<button class="sh-close" id="shClose" aria-label="關閉">' +
      '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg></button>' +
      '<div class="sh-top"><div class="sh-name">' + esc(p.n || '(未命名)') + '</div>' +
      '<div class="sh-av ' + k + '">' + av + '</div></div>' +
      '<div class="chips">' +
        '<span class="chip">' + esc(p.c === '北' ? '台北' : p.c === '新' ? '新北' : '桃園') + '</span>' +
        (p.k === 'street' ? '<span class="chip">路邊</span>' : '') +
        (p.a ? '<span class="chip">' + esc(p.a) + '</span>' : '') +
        (ft ? '<span class="chip ' + (p.fk === 'free' ? 'fee0' : 'fee') + '">' + esc(ft) + '</span>' : '') +
      '</div>' +
      '<div class="sh-scroll"><div class="sh-meta">距離 ' + fmtD(d) + ',走路約 ' + walk(d) +
        (p.r ? '<br>' + esc(p.r) : '') + '</div></div>' +
      '<div class="navrow">' +
        '<a class="navbtn" target="_blank" rel="noopener" href="' + u.apple + '">Apple 地圖</a>' +
        '<a class="navbtn alt" target="_blank" rel="noopener" href="' + u.google + '">Google 地圖</a>' +
      '</div>';
    $('sheet').hidden = false;
    var cb = $('shClose');
    if (cb) cb.addEventListener('click', function (e) { e.stopPropagation(); closeSheet(); });
  }
  function closeSheet() {
    sel = null; $('sheet').hidden = true;
    setSheet(beforeDetail === 'off' ? 'peek' : beforeDetail);   // 回到剛剛看的清單
    refreshPins();
  }

  // ---------- 清單 ----------
  function renderList() {
    var near = [];
    for (var i = 0; i < P.length; i++) {
      var p = P[i];
      if (filterKind !== 'all' && p.k !== filterKind) continue;
      if (filterAvail === 'free' && !(p.av > 0)) continue;
      p._d = dist(me.lat, me.lon, p.lat, p.lon);
      if (p._d <= 5000) near.push(p);
    }
    if (sortMode === 'price') near.sort(function (a, b) { var x = feeKey(a) - feeKey(b); return x || a._d - b._d; });
    else near.sort(function (a, b) { return a._d - b._d; });
    near = near.slice(0, 80);

    var cntEl = $('listCount');
    if (cntEl) cntEl.textContent = near.length ? '· ' + near.length + ' 個有空位' : '· 附近沒有';
    var body = $('listBody');
    if (!near.length) {
      body.innerHTML = '<div class="empty">附近 5 公里內沒有符合的地點。<br>試試切到「全部」,或把地圖移到別的地方。</div>';
      return;
    }
    var h = '';
    for (var j = 0; j < near.length; j++) {
      var p2 = near[j], k = cls(p2), ft = feeShort(p2);
      h += '<div class="row" data-i="' + j + '">' +
           '<div class="rmain"><div class="rn">' + esc(p2.n || '') + '</div>' +
           '<div class="rm">' + (ft ? '<span>' + esc(ft) + (p2.fk === 'hour' ? '/時' : p2.fk === 'visit' ? '/次' : '') + '</span>' : '<span>費率未提供</span>') +
           (p2.a ? '<span>' + esc(p2.a) + '</span>' : '') +
           (p2.k === 'street' ? '<span>路邊</span>' : '') + '</div></div>' +
           '<div class="rav ' + k + '"><b>' + (p2.av == null ? '未知' : p2.av) + '</b>' +
           (p2.tot ? '<span class="rd"> / ' + p2.tot + '</span>' : '') +
           '<div class="rd">' + fmtD(p2._d) + ' · 走 ' + walk(p2._d) + '</div></div></div>';
    }
    body.innerHTML = h;
    body.querySelectorAll('.row').forEach(function (el) {
      el.addEventListener('click', function () {
        var p3 = near[parseInt(el.dataset.i, 10)];
        map.setView([p3.lat, p3.lon], Math.max(map.getZoom(), 16));
        openSheet(p3);   // 會記住目前展開狀態,關掉詳情就回到這裡
      });
    });
  }


  // ---------- 可拖曳的底部面板 ----------
  var PEEK = 78;                       // 收起來時露出的高度
  function paneH() { return $('listPane').getBoundingClientRect().height; }
  function offsetFor(state) {
    var H = paneH();
    if (state === 'full') return 0;
    if (state === 'half') return Math.round(H * 0.46);
    if (state === 'off') return H;     // 完全滑出畫面
    return Math.max(0, H - PEEK);      // peek
  }
  function setSheet(state, skipAnim) {
    sheetState = state;
    var pane = $('listPane');
    pane.classList.toggle('peek', state === 'peek');
    pane.classList.toggle('off', state === 'off');
    if (skipAnim) pane.classList.add('dragging');
    pane.style.transform = 'translateY(' + offsetFor(state) + 'px)';
    if (skipAnim) requestAnimationFrame(function () { pane.classList.remove('dragging'); });
    $('listBtn').classList.toggle('on', state !== 'peek' && state !== 'off');
    if (state !== 'peek' && state !== 'off') renderList();
  }
  function initSheetDrag() {
    var pane = $('listPane');
    var startOff = null, startY = 0, moved = 0, curY = 0;

    function begin(y, target) {
      if (target && target.closest && target.closest('button')) return false;
      startOff = offsetFor(sheetState); curY = startOff; startY = y; moved = 0;
      pane.classList.add('dragging');
      return true;
    }
    function move(y) {
      if (startOff == null) return;
      var dy = y - startY;
      moved = Math.max(moved, Math.abs(dy));
      var H = paneH();
      curY = Math.min(Math.max(0, startOff + dy), Math.max(0, H - PEEK));
      pane.style.transform = 'translateY(' + curY + 'px)';
    }
    function end() {
      if (startOff == null) return;
      pane.classList.remove('dragging');
      if (moved < 8) {
        setSheet(sheetState === 'half' || sheetState === 'full' ? 'peek' : 'half');
      } else {
        var best = 'peek', bd = Infinity;
        ['full', 'half', 'peek'].forEach(function (st) {
          var d = Math.abs(offsetFor(st) - curY);
          if (d < bd) { bd = d; best = st; }
        });
        setSheet(best);
      }
      startOff = null;
    }

    /* 🔴 用 touch 事件,不用 pointer 事件。
       iOS Safari 會在它判定這是頁面手勢時直接送 pointercancel,
       而且在 pointerdown 裡呼叫 preventDefault 反而會讓後續 pointermove 不發生。
       touchstart/touchmove/touchend 在 iOS 上最穩,桌機另外走 mouse 事件。 */
    function onTouchStart(e) {
      if (e.touches.length !== 1) return;
      if (!begin(e.touches[0].clientY, e.target)) return;
      e.preventDefault();          // 在 touchstart 擋,才不會被當成捲動
    }
    function onTouchMove(e) {
      if (startOff == null) return;
      e.preventDefault();
      move(e.touches[0].clientY);
    }
    var handles = [];
    ['#grip', '.listhead'].forEach(function (q) {
      var el = pane.querySelector(q);
      if (el) handles.push(el);
    });
    handles.forEach(function (el) {
      el.addEventListener('touchstart', onTouchStart, { passive: false });
      el.addEventListener('touchmove', onTouchMove, { passive: false });
      el.addEventListener('touchend', end);
      el.addEventListener('touchcancel', end);
      // 桌機
      el.addEventListener('mousedown', function (e) {
        if (!begin(e.clientY, e.target)) return;
        e.preventDefault();
        function mm(ev) { move(ev.clientY); }
        function mu() {
          window.removeEventListener('mousemove', mm);
          window.removeEventListener('mouseup', mu);
          end();
        }
        window.addEventListener('mousemove', mm);
        window.addEventListener('mouseup', mu);
      });
    });

    window.addEventListener('resize', function () { setSheet(sheetState, true); });
    setSheet('peek', true);
  }

  // ---------- 定位 ----------
  function locate() {
    var Geo = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation) || null;
    var done = function (lat, lon) {
      setMe(lat, lon, true);
      map.setView([lat, lon], Math.max(map.getZoom(), 15));
      toast('已定位');
    };
    var fail = function () {
      toast('拿不到定位。長按「定位」鈕可以改成在地圖上手動指定。', 3600);
    };
    if (Geo && Geo.getCurrentPosition) {
      Geo.requestPermissions().catch(function () { return null; }).then(function () {
        return Geo.getCurrentPosition({ enableHighAccuracy: true, timeout: 12000 });
      }).then(function (pos) { done(pos.coords.latitude, pos.coords.longitude); }).catch(fail);
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        function (pos) { done(pos.coords.latitude, pos.coords.longitude); },
        fail, { enableHighAccuracy: true, timeout: 12000 });
    } else fail();
  }

  // ---------- 事件 ----------
  function bind() {
    document.querySelectorAll('[data-filter]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('[data-filter]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); filterAvail = b.dataset.filter;
        refreshPins(); renderList();
      });
    });
    document.querySelectorAll('[data-kind]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('[data-kind]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); filterKind = b.dataset.kind;
        refreshPins(); renderList();
      });
    });
    document.querySelectorAll('[data-sort]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('[data-sort]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); sortMode = b.dataset.sort; renderList();
      });
    });
    var lb = $('locBtn'), holdT = null;
    lb.addEventListener('click', function () { if (!picking) locate(); else setPicking(false); });
    lb.addEventListener('pointerdown', function () {
      holdT = setTimeout(function () { setPicking(true); toast('點地圖上任一點設定你的位置'); }, 550);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      lb.addEventListener(ev, function () { clearTimeout(holdT); });
    });
    $('listBtn').addEventListener('click', function () {
      if (!$('sheet').hidden) { sel = null; $('sheet').hidden = true; refreshPins(); }
      setSheet(sheetState === 'half' || sheetState === 'full' ? 'peek' : 'half');
    });
    $('listClose').addEventListener('click', function () { setSheet('peek'); });
    initSheetDrag();
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) fetchFresh().catch(function () {});
    });
  }

  // ---------- 啟動 ----------
  function boot() {
    initMap(); bind();
    var hadCache = loadCache();
    if (hadCache) toast('先顯示存下的資料,更新中…', 1800);
    fetchFresh().catch(function () {
      if (!hadCache) {
        $('listBody').innerHTML = '';
        toast('連不上資料來源,而且本機沒有存檔。請檢查網路後重開。', 5000);
      }
    });
    setInterval(function () { fetchFresh().catch(function () {}); }, 5 * 60 * 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
