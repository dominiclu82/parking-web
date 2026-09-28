/* 車位 —— 北北桃停車位。資料來自各市政府開放資料,由樹莓派每 10 分鐘聚合後發佈。 */
(function () {
  'use strict';

  var DATA_BASE = 'https://dominiclu82.github.io/parking-data/data/';
  var HOME = { lat: 25.0777, lon: 121.2328, z: 14 };   // 預設:桃園機場
  var MAX_PINS = 260;          // 同時畫在地圖上的上限,超過會卡
  var LS = { data: 'pk.data', meta: 'pk.meta', at: 'pk.at', me: 'pk.me',
             fav: 'pk.fav', theme: 'pk.theme', tab: 'pk.tab',
             lang: 'pk.lang', font: 'pk.font' };
  var VERSION = '0.2.0';

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
  function walk(m) { return Math.max(1, Math.round(m / 80)) + t('min'); }

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
    var av = p.av == null ? '<span class="n">' + t('unknown') + '</span><div class="t">' + t('unknownSrc') + '</div>'
           : '<span class="n">' + p.av + '</span><div class="t">' + (p.tot ? t('of') + ' ' + p.tot : t('spaces')) + '</div>';
    $('sheetBody').innerHTML =
      '<button class="sh-close" id="shClose" aria-label="關閉">' +
      '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg></button>' +
      '<div class="sh-top"><div class="sh-name">' + esc(p.n || '(未命名)') + '</div>' +
      '<div class="sh-av ' + k + '">' + av + '</div></div>' +
      '<div class="chips">' +
        '<span class="chip">' + esc(cityName(p.c)) + '</span>' +
        (p.k === 'street' ? '<span class="chip">' + t('street') + '</span>' : '') +
        (p.a ? '<span class="chip">' + esc(p.a) + '</span>' : '') +
        (ft ? '<span class="chip ' + (p.fk === 'free' ? 'fee0' : 'fee') + '">' + esc(ft) + '</span>' : '') +
      '</div>' +
      '<div class="sh-scroll"><div class="sh-meta">距離 ' + fmtD(d) + ',走路約 ' + walk(d) +
        (p.r ? '<br>' + esc(p.r) : '') + '</div></div>' +
      '<div class="navrow">' +
        '<a class="navbtn" target="_blank" rel="noopener" href="' + u.apple + '">' + t('appleMap') + '</a>' +
        '<a class="navbtn alt" target="_blank" rel="noopener" href="' + u.google + '">' + t('googleMap') + '</a>' +
        '<button class="favbtn' + (isFav(p) ? ' on' : '') + '" id="favToggle">' +
          (isFav(p) ? t('favOn') : t('favAdd')) + '</button>' +
      '</div>';
    $('sheet').hidden = false;
    var cb = $('shClose');
    if (cb) cb.addEventListener('click', function (e) { e.stopPropagation(); closeSheet(); });
    var fb = $('favToggle');
    if (fb) fb.addEventListener('click', function (e) {
      e.stopPropagation();
      var now = toggleFav(p);
      fb.classList.toggle('on', now);
      fb.textContent = now ? t('favOn') : t('favAdd');
    });
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
    if (cntEl) cntEl.textContent = near.length ? t('nHasSpace')(near.length) : t('nNone');
    var body = $('listBody');
    if (!near.length) {
      body.innerHTML = '<div class="empty">' + t('noneNear') + '</div>';
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
        ['full', 'half', 'peek', 'off'].forEach(function (st) {
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


  // ---------- 分頁 ----------
  var curTab = 'near';
  function switchTab(t) {
    curTab = t;
    lsSet(LS.tab, t);
    ['near', 'search', 'fav', 'set'].forEach(function (k) {
      var pane = $('pane-' + k);
      if (pane) pane.classList.toggle('on', k === t);
    });
    document.querySelectorAll('.tab').forEach(function (b) {
      b.classList.toggle('on', b.dataset.tab === t);
    });
    showTabbar();                       // 換頁一定要看得到選單
    if (t === 'near' && map) setTimeout(function () { map.invalidateSize(); }, 60);
    if (t === 'fav') renderFav();
    if (t === 'set') renderSettings();
  }

  // ---------- 底列:操作地圖時縮成把手,閒置 2.5 秒浮回 ----------
  var tabIdle = null;
  function showTabbar() {
    $('tabbar').classList.remove('hidden');
    clearTimeout(tabIdle);
  }
  /* 🔴 刻意不做「操作地圖時收合底列」。Jetstream 那個做法是給次要的全畫面頁用的;
     這個 App 的主畫面就是地圖,一動就收等於版號永遠看不到(Dominic 2026-09-28)。 */

  // ---------- 常用 ----------
  function favKey(p) { return p.c + '|' + p.k + '|' + p.n + '|' + p.lat.toFixed(4); }
  function favList() {
    try { return JSON.parse(lsGet(LS.fav) || '[]'); } catch (e) { return []; }
  }
  function isFav(p) {
    var k = favKey(p);
    return favList().some(function (x) { return x.key === k; });
  }
  function toggleFav(p) {
    var k = favKey(p), arr = favList();
    var i = arr.findIndex(function (x) { return x.key === k; });
    if (i >= 0) { arr.splice(i, 1); toast('已移除常用'); }
    else { arr.push({ key: k, n: p.n, c: p.c, a: p.a, lat: p.lat, lon: p.lon, k2: p.k }); toast('已加入常用'); }
    lsSet(LS.fav, JSON.stringify(arr));
    return i < 0;
  }
  function findByKey(k) {
    for (var i = 0; i < P.length; i++) if (favKey(P[i]) === k) return P[i];
    return null;
  }
  function renderFav() {
    var arr = favList(), el = $('favBody');
    if (!arr.length) {
      el.innerHTML = '<div class="empty">' + t('favEmpty') + '</div>';
      return;
    }
    var h = '<div class="favlist">';
    arr.forEach(function (f, i) {
      var live = findByKey(f.key);
      var av = live ? (live.av == null ? '未知' : live.av) : '—';
      var k = live ? cls(live) : 'unk';
      var d = dist(me.lat, me.lon, f.lat, f.lon);
      h += '<div class="row" data-k="' + esc(f.key) + '">' +
           '<div class="rmain"><div class="rn">' + esc(f.n || '') + '</div>' +
           '<div class="rm"><span>' + esc(cityName(f.c)) + '</span>' +
           (f.a ? '<span>' + esc(f.a) + '</span>' : '') + '<span>' + fmtD(d) + '</span></div></div>' +
           '<div class="rav ' + k + '"><b>' + av + '</b><div class="rd">' + t('spaces') + '</div></div>' +
           '<button class="favbtn" data-del="' + i + '" style="margin-left:10px">' + t('remove') + '</button></div>';
    });
    el.innerHTML = h + '</div>';
    el.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var a2 = favList(); a2.splice(parseInt(b.dataset.del, 10), 1);
        lsSet(LS.fav, JSON.stringify(a2)); renderFav();
      });
    });
    el.querySelectorAll('.row').forEach(function (r) {
      r.addEventListener('click', function () {
        var p = findByKey(r.dataset.k);
        if (!p) { toast('這個地點目前沒有在資料裡'); return; }
        switchTab('near');
        map.setView([p.lat, p.lon], 16);
        openSheet(p);
      });
    });
  }

  // ---------- 搜尋 ----------
  function runSearch() {
    var q = ($('q').value || '').trim();
    var box = $('qres');
    if (!q) { box.innerHTML = ''; $('qhint').textContent = '輸入關鍵字,例如「南崁」「文中路」「機場」'; return; }
    var hit = [];
    for (var i = 0; i < P.length && hit.length < 200; i++) {
      var p = P[i];
      if ((p.n && p.n.indexOf(q) >= 0) || (p.a && p.a.indexOf(q) >= 0)) {
        p._d = dist(me.lat, me.lon, p.lat, p.lon);
        hit.push(p);
      }
    }
    hit.sort(function (a, b) { return a._d - b._d; });
    hit = hit.slice(0, 60);
    $('qhint').textContent = hit.length ? t('qfound')(hit.length) : t('qnone');
    var h = '';
    hit.forEach(function (p, j) {
      var k = cls(p), ft = feeShort(p);
      h += '<div class="row" data-j="' + j + '">' +
           '<div class="rmain"><div class="rn">' + esc(p.n || '') + '</div>' +
           '<div class="rm">' + (ft ? '<span>' + esc(ft) + '</span>' : '') +
           (p.a ? '<span>' + esc(p.a) + '</span>' : '') + '<span>' + fmtD(p._d) + '</span></div></div>' +
           '<div class="rav ' + k + '"><b>' + (p.av == null ? '未知' : p.av) + '</b>' +
           (p.tot ? '<span class="rd"> / ' + p.tot + '</span>' : '') + '</div></div>';
    });
    box.innerHTML = h;
    box.querySelectorAll('.row').forEach(function (r) {
      r.addEventListener('click', function () {
        var p = hit[parseInt(r.dataset.j, 10)];
        switchTab('near');
        map.setView([p.lat, p.lon], 16);
        openSheet(p);
      });
    });
  }

  // ---------- 設定 ----------
  var SRCNAME = { taipei: '臺北市停車場', ntpc_lot: '新北市停車場', ntpc_street: '新北市路邊', taoyuan: '桃園市停車場' };
  function renderSettings() {
    var at = parseInt(lsGet(LS.at) || '0', 10);
    var h = '<div class="card2"><h2>資料狀態</h2>';
    h += '<div class="kv"><span>本機最後更新</span><span>' +
         (at ? new Date(at).toLocaleString('zh-TW', { hour12: false }) : '尚未取得') + '</span></div>';
    h += '<div class="kv"><span>地點總數</span><span>' + P.length.toLocaleString() + '</span></div>';
    h += '<div class="kv"><span>有即時空位</span><span>' +
         P.filter(function (p) { return p.av != null; }).length.toLocaleString() + '</span></div>';
    if (META && META.generated) h += '<div class="kv"><span>來源產生時間</span><span>' + esc(META.generated.replace('T', ' ').slice(0, 16)) + '</span></div>';
    h += '</div>';

    if (META && META.sources) {
      h += '<div class="card2"><h2>各來源</h2>';
      Object.keys(META.sources).forEach(function (k) {
        var sc = META.sources[k];
        h += '<div class="kv"><span><i class="okdot ' + (sc.ok ? 'y' : 'n') + '"></i>' +
             esc(SRCNAME[k] || k) + '</span><span>' +
             (sc.ok ? (sc.count || 0) + ' 筆' : (sc.stale ? sc.ageMin + ' 分鐘前的快取' : '沒有資料')) +
             '</span></div>';
      });
      h += '<p>資料每 10 分鐘更新一次。某個來源抓不到時會沿用上一次成功的結果,並在這裡標示。</p></div>';
    }

    h += '<div class="card2"><h2>資料來源</h2><p>' +
         '臺北市、新北市、桃園市政府開放資料平臺,依<b>政府資料開放授權條款－第 1 版</b>使用。<br>' +
         '地圖圖磚 © OpenStreetMap 貢獻者。<br><br>' +
         '⚠︎ 空位顯示「未知」代表來源沒有提供該筆資料,不是沒有空位。<br>' +
         '⚠︎ 新北市路邊車格的狀態碼含意尚未經官方文件確認,路邊的數字請當作參考。<br>' +
         '⚠︎ 所有資訊可能因更新延遲與現場不同,請以現場標示為準。</p></div>';

    h += '<div class="card2"><h2>關於</h2>' +
         '<div class="kv"><span>版本</span><span>' + VERSION + '</span></div>' +
         '<div class="kv"><span>涵蓋範圍</span><span>臺北 · 新北 · 桃園</span></div></div>';
    $('setBody').innerHTML = h;
  }

  // ---------- 日夜 ----------
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    lsSet(LS.theme, t);
    var b = $('themeBtn');
    if (b) b.textContent = t === 'dark' ? '☾' : t === 'light' ? '☀︎' : '◐';
  }
  function cycleTheme() {
    var cur = lsGet(LS.theme) || 'auto';
    applyTheme(cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto');
    if (map) setTimeout(function () { refreshPins(); }, 30);
  }


  // ---------- 中英 ----------
  var I18N = {
    zh: {
      near: '附近', search: '搜尋', fav: '常用', set: '設定',
      hasSpace: '有空位', all: '全部', lots: '停車場', street: '路邊',
      nearby: '附近車位', sortDist: '最近', sortPrice: '最便宜',
      legFree: '有位', legTight: '快滿', legFull: '滿', legUnk: '未知',
      qph: '停車場名稱、路段或行政區',
      qhint: '輸入關鍵字,例如「南崁」「文中路」「機場」',
      qfound: function (n) { return '找到 ' + n + ' 個(依距離排序)'; },
      qnone: '找不到符合的地點',
      favEmpty: '還沒有常用地點。<br>在地圖上點任一個車位,詳情卡右下角按「☆ 常用」就會加進來。',
      favAdd: '☆ 常用', favOn: '★ 常用', remove: '移除',
      appleMap: 'Apple 地圖', googleMap: 'Google 地圖',
      spaces: '空位', of: '共', unknown: '未知', unknownSrc: '來源未提供',
      distTo: function (d, w) { return '距離 ' + d + ',走路約 ' + w; },
      pickHint: '點地圖選擇位置', located: '已定位',
      locFail: '拿不到定位。長按「定位」鈕可以改成在地圖上手動指定。',
      pickTip: '點地圖上任一點設定你的位置',
      noneNear: '附近 5 公里內沒有符合的地點。<br>試試切到「全部」,或把地圖移到別的地方。',
      nHasSpace: function (n) { return '· ' + n + ' 個有空位'; }, nNone: '· 附近沒有',
      changelog: '更新日誌', community: '💬 社群討論(可匿名)', report: '🔒 私下回報',
      reportSoon: '私下回報(尚未開放)',
      taipei: '台北', ntpc: '新北', tyc: '桃園',
      setData: '資料狀態', setSrc: '各來源', setAbout: '關於', setSources: '資料來源',
      lastUpd: '本機最後更新', total: '地點總數', withAv: '有即時空位',
      genAt: '來源產生時間', version: '版本', coverage: '涵蓋範圍',
      notYet: '尚未取得', rows: ' 筆', cacheAgo: function (m) { return m + ' 分鐘前的快取'; },
      noData: '沒有資料', min: '分', km: 'km', m: 'm'
    },
    en: {
      near: 'Nearby', search: 'Search', fav: 'Saved', set: 'Settings',
      hasSpace: 'Available', all: 'All', lots: 'Car parks', street: 'On-street',
      nearby: 'Nearby parking', sortDist: 'Closest', sortPrice: 'Cheapest',
      legFree: 'Free', legTight: 'Filling', legFull: 'Full', legUnk: 'Unknown',
      qph: 'Car park name, street or district',
      qhint: 'Try a place name, e.g. "Nankan", "Airport"',
      qfound: function (n) { return n + ' found (by distance)'; },
      qnone: 'No matching places',
      favEmpty: 'No saved places yet.<br>Tap any parking spot on the map, then tap "☆ Save" in the detail card.',
      favAdd: '☆ Save', favOn: '★ Saved', remove: 'Remove',
      appleMap: 'Apple Maps', googleMap: 'Google Maps',
      spaces: 'free', of: 'of', unknown: 'Unknown', unknownSrc: 'not provided',
      distTo: function (d, w) { return d + ' away, about ' + w + ' on foot'; },
      pickHint: 'Tap the map to set your location', located: 'Location set',
      locFail: 'Could not get your location. Press and hold the locate button to pick a spot on the map.',
      pickTip: 'Tap anywhere on the map to set your location',
      noneNear: 'Nothing matching within 5 km.<br>Try "All", or move the map elsewhere.',
      nHasSpace: function (n) { return '· ' + n + ' with space'; }, nNone: '· none nearby',
      changelog: 'What’s new', community: '💬 Community (anonymous)', report: '🔒 Private report',
      reportSoon: 'Private report (not yet available)',
      taipei: 'Taipei', ntpc: 'New Taipei', tyc: 'Taoyuan',
      setData: 'Data status', setSrc: 'Sources', setAbout: 'About', setSources: 'Attribution',
      lastUpd: 'Last updated on device', total: 'Places', withAv: 'With live availability',
      genAt: 'Generated at', version: 'Version', coverage: 'Coverage',
      notYet: 'Not yet fetched', rows: '', cacheAgo: function (m) { return 'cached ' + m + ' min ago'; },
      noData: 'No data', min: ' min', km: 'km', m: 'm'
    }
  };
  var lang = 'zh';
  function t(k) { return (I18N[lang] && I18N[lang][k]) != null ? I18N[lang][k] : I18N.zh[k]; }
  function cityName(c) { return c === '北' ? t('taipei') : c === '新' ? t('ntpc') : t('tyc'); }

  function applyLang(l) {
    lang = (l === 'en') ? 'en' : 'zh';
    lsSet(LS.lang, lang);
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant';
    var B = $('langBtn'); if (B) B.textContent = lang === 'en' ? 'EN' : '中';
    // 底列
    document.querySelectorAll('.tab').forEach(function (b) {
      var l2 = b.querySelector('.tl'); if (l2) l2.textContent = t(b.dataset.tab);
    });
    // 標題
    var map2 = { 'pane-search': 'search', 'pane-fav': 'fav', 'pane-set': 'set' };
    Object.keys(map2).forEach(function (id) {
      var h = document.querySelector('#' + id + ' h1'); if (h) h.textContent = t(map2[id]);
    });
    // 篩選 / 排序
    var F = { free: 'hasSpace', all: 'all' }, K = { all: 'all', lot: 'lots', street: 'street' },
        S = { dist: 'sortDist', price: 'sortPrice' };
    document.querySelectorAll('[data-filter]').forEach(function (b) { b.textContent = t(F[b.dataset.filter]); });
    document.querySelectorAll('[data-kind]').forEach(function (b) { b.textContent = t(K[b.dataset.kind]); });
    document.querySelectorAll('[data-sort]').forEach(function (b) { b.textContent = t(S[b.dataset.sort]); });
    // 圖例
    var lg = $('legend');
    if (lg) {
      var names = ['legFree', 'legTight', 'legFull', 'legUnk'];
      lg.querySelectorAll('span').forEach(function (sp, i) {
        var ic = sp.querySelector('i'); sp.innerHTML = ''; if (ic) sp.appendChild(ic);
        sp.appendChild(document.createTextNode(t(names[i])));
      });
    }
    $('listTitle').textContent = t('nearby');
    $('pickHint').textContent = t('pickHint');
    var qi = $('q'); if (qi) qi.placeholder = t('qph');
    var qh = $('qhint'); if (qh && !(qi && qi.value.trim())) qh.textContent = t('qhint');
    document.querySelectorAll('[data-i18n]').forEach(function (e) { e.textContent = t(e.dataset.i18n); });
    renderList(); if (curTab === 'fav') renderFav();
    if (curTab === 'set') renderSettings(); if (curTab === 'search') runSearch();
    if (sel) openSheet(sel);
    renderStale(false);
  }

  // ---------- 字級 ----------
  var FS = [15, 16, 17, 19, 21];
  function applyFont(i) {
    i = Math.max(0, Math.min(FS.length - 1, i));
    lsSet(LS.font, String(i));
    document.documentElement.style.fontSize = FS[i] + 'px';
    if (map) setTimeout(function () { map.invalidateSize(); }, 60);
  }
  function fontIdx() { return parseInt(lsGet(LS.font) || '1', 10) || 1; }

  // ---------- 更新日誌 ----------
  var CHANGELOG = [
    { v: '0.2.0', d: '2026-09-28', items: [
      ['新增地點搜尋。', 'You can now search for places.'],
      ['新增常用地點。', 'You can now save places.'],
      ['新增英文介面。', 'English is now available.']
    ] },
    { v: '0.1.0', d: '2026-09-28', items: [
      ['北北桃即時車位地圖。', 'Live parking map for northern Taiwan.']
    ] }
  ];
  // 家族共用的同一個社群連結(跟 CrewSync / PeakLog / Jetstream 同一顆)
  var LINE_URL = 'https://line.me/ti/g2/ArAw4k1D9vXEAMtBsButFLzSFjXzEvFXfKHQ2A';
  var SUPPORT_MAIL = 'support@h-peak.com';
  function reportMailto() {
    var T = function (zh, en) { return lang === 'en' ? en : zh; };
    var L = [];
    L.push(T('(請在這裡描述問題,下面是診斷資訊,可以自行刪除)',
             '(Describe the problem here. Diagnostics below — feel free to delete.)'));
    L.push(''); L.push('---');
    L.push('App: 停哪裡 / Taiwan Parking  v' + VERSION);
    L.push('Lang: ' + lang);
    var at = parseInt(lsGet(LS.at) || '0', 10);
    L.push('Data fetched: ' + (at ? new Date(at).toISOString() : 'n/a'));
    if (META && META.generated) L.push('Data generated: ' + META.generated);
    L.push('Places: ' + P.length);
    if (META && META.sources) {
      Object.keys(META.sources).forEach(function (k) {
        var sc = META.sources[k];
        L.push('  ' + k + ': ' + (sc.ok ? 'ok ' + sc.count : 'FAIL ' + (sc.error || '')));
      });
    }
    if (map) {
      var c = map.getCenter();
      L.push('Map: ' + c.lat.toFixed(5) + ',' + c.lng.toFixed(5) + ' z' + map.getZoom());
    }
    if (sel) L.push('Viewing: ' + (sel.n || '') + ' (' + sel.c + ')');
    L.push('UA: ' + (navigator.userAgent || '').slice(0, 120));
    var subj = T('停哪裡 回報 v', 'Taiwan Parking report v') + VERSION;
    return 'mailto:' + SUPPORT_MAIL +
           '?subject=' + encodeURIComponent(subj) +
           '&body=' + encodeURIComponent(L.join('\n'));
  }

  function openAbout() {
    var T = function (zh, en) { return lang === 'en' ? en : zh; };
    $('aboutTop').innerHTML =
      '<div class="ovhead"><strong>' + T('更新日誌', 'What’s new') + '</strong>' +
      '<button id="aboutClose" class="iconbtn" aria-label="' + T('關閉', 'Close') + '">' +
      '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>' +
      '</button></div>' +
      '<div class="ovsub">' + T('北北桃即時車位地圖', 'Live parking map for northern Taiwan') + '</div>' +
      '<div class="ovver">v' + VERSION + '</div>' +
      '<div class="lang2">' +
        '<button id="clZh" class="' + (lang === 'zh' ? 'on' : '') + '">中文</button>' +
        '<button id="clEn" class="' + (lang === 'en' ? 'on' : '') + '">EN</button>' +
      '</div>' +
      /* 社群(公開、可匿名)與私下回報各一半。分兩顆的理由:回報常要附截圖,
         貼進社群等於公開給群裡每個人看。⚠ 右邊那顆不要叫「寄信」——
         使用者不寄信(信是伺服器寄的),叫寄信他會以為要跳出信箱而不敢按。 */
      '<div class="rep2">' +
        '<a class="comm" href="' + LINE_URL + '" target="_blank" rel="noopener">💬 ' +
          T('社群討論', 'Community') + '<div class="sub2">' + T('可匿名 Anonymous', 'Anonymous') + '</div></a>' +
        '<a class="priv" id="clReport" href="' + reportMailto() + '">🔒 ' +
          T('私下回報', 'Private report') + '<div class="sub2">' + T('不公開 Private', 'Private') + '</div></a>' +
      '</div>';

    var h = '';
    CHANGELOG.forEach(function (c) {
      h += '<div class="cl"><span class="v">v' + c.v + '</span><span class="d">' + c.d + '</span><ul>';
      c.items.forEach(function (it) { h += '<li>' + esc(lang === 'en' ? it[1] : it[0]) + '</li>'; });
      h += '</ul></div>';
    });
    $('aboutBody').innerHTML = h;

    // Apple 送審要求政策與支援入口要找得到,不能只藏在捲動內容尾端
    $('aboutFoot').innerHTML =
      '<span>' + T('資料來源:臺北市、新北市、桃園市政府開放資料平臺',
                   'Data: Taipei, New Taipei & Taoyuan open data') + '</span>';

    $('clZh').addEventListener('click', function () { applyLang('zh'); openAbout(); });
    $('clEn').addEventListener('click', function () { applyLang('en'); openAbout(); });
    $('aboutOv').hidden = false;
  }

  // ---------- 定位 ----------
  function locate() {
    var Geo = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation) || null;
    var done = function (lat, lon) {
      setMe(lat, lon, true);
      map.setView([lat, lon], Math.max(map.getZoom(), 15));
      toast(t('located'));
    };
    var fail = function () {
      toast(t('locFail'), 3600);
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
      holdT = setTimeout(function () { setPicking(true); toast(t('pickTip')); }, 550);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      lb.addEventListener(ev, function () { clearTimeout(holdT); });
    });
    initSheetDrag();
    document.querySelectorAll('.tab').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.tab); });
    });
    $('themeBtn').addEventListener('click', cycleTheme);
    $('langBtn').addEventListener('click', function () { applyLang(lang === 'zh' ? 'en' : 'zh'); });
    $('fontUp').addEventListener('click', function () { applyFont(fontIdx() + 1); });
    $('fontDn').addEventListener('click', function () { applyFont(fontIdx() - 1); });
    $('aboutOv').addEventListener('click', function (e) { if (e.target === $('aboutOv')) $('aboutOv').hidden = true; });
    $('verBtn').textContent = 'v' + VERSION;
    $('verBtn').addEventListener('click', openAbout);
    var qi = $('q');
    if (qi) {
      var qt = null;
      qi.addEventListener('input', function () { clearTimeout(qt); qt = setTimeout(runSearch, 160); });
      qi.addEventListener('search', runSearch);
    }
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) fetchFresh().catch(function () {});
    });
  }

  // ---------- 啟動 ----------

  /* 🔴 GitHub Pages 的 HTML 帶 max-age=600,手機會抓到最多 10 分鐘前的舊 index.html,
     於是連帶載到舊的 app.js —— 我們因此一起追過好幾個「已經修掉」的 bug。
     解法:開機時比對伺服器上的 build 戳記,不一樣就自己重載一次(只會發生一次)。 */
  function selfUpdate() {
    var mine = (function () {
      var m = (document.currentScript && document.currentScript.src) || '';
      var all = document.getElementsByTagName('script');
      for (var i = 0; i < all.length; i++) if (/app\.js/.test(all[i].src)) m = all[i].src;
      var q = /[?&]v=(\d+)/.exec(m || '');
      return q ? q[1] : null;
    })();
    if (!mine) return;
    fetch('build.txt?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (txt) {
        if (!txt) return;
        var latest = txt.trim();
        if (!/^\d+$/.test(latest) || latest === mine) return;
        var tried = 0;
        try { tried = parseInt(sessionStorage.getItem('pk.reload') || '0', 10) || 0; } catch (e) {}
        if (tried >= 2) return;                       // 防呆:最多自動重載兩次
        try { sessionStorage.setItem('pk.reload', String(tried + 1)); } catch (e) {}
        location.replace(location.pathname + '?b=' + latest);
      })
      .catch(function () {});
  }

  function boot() {
    applyTheme(lsGet(LS.theme) || 'auto');
    applyFont(fontIdx());
    initMap(); bind();
    switchTab('near');
    applyLang(lsGet(LS.lang) || (/^zh/i.test(navigator.language || '') ? 'zh' : 'en'));
    var hadCache = loadCache();
    if (hadCache) toast('先顯示存下的資料,更新中…', 1800);
    fetchFresh().catch(function () {
      if (!hadCache) {
        $('listBody').innerHTML = '';
        toast('連不上資料來源,而且本機沒有存檔。請檢查網路後重開。', 5000);
      }
    });
    setInterval(function () { fetchFresh().catch(function () {}); }, 5 * 60 * 1000);
    selfUpdate();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
