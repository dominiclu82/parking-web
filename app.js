/* 停哪裡 / Taiwan Parking
   北北桃即時車位。資料由樹莓派每 10 分鐘從各市政府開放資料平臺聚合後發佈。
   底部主選單的樣式與 DOM 照家族規格(vendor/hpeak-ui.css + jetstream/public/hpeak-tab.js)。 */
(function () {
  'use strict';

  var VERSION = '0.3.0';
  var DATA_BASE = 'https://data.h-peak.com/data/';
  var LINE_URL = 'https://line.me/ti/g2/ArAw4k1D9vXEAMtBsButFLzSFjXzEvFXfKHQ2A';  // 家族共用
  var SUPPORT_MAIL = 'support@h-peak.com';
  var LEGAL = 'https://parking.h-peak.com/legal/';
  var HOME = { lat: 25.0777, lon: 121.2328, z: 14 };
  var MAX_PINS = 260;
  var LS = { data:'pk.data', meta:'pk.meta', at:'pk.at', me:'pk.me',
             fav:'pk.fav', theme:'pk.theme', lang:'pk.lang', font:'pk.font' };

  var P = [], META = null, map = null, layer = null, meMarker = null, HIT = [];
  var sel = null, picking = false, sortMode = 'dist';
  var filterAvail = 'free', filterKind = 'all';
  var me = { lat: HOME.lat, lon: HOME.lon };
  var curTab = 'near', sheetState = 'peek', beforeDetail = 'peek', lang = 'zh';

  function $(id) { return document.getElementById(id); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c];
    });
  }
  function toast(msg, ms) {
    var el = $('toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { el.hidden = true; }, ms || 2600);
  }

  /* ────────── 中英 ────────── */
  var I18N = {
    zh: {
      near:'附近', search:'搜尋', fav:'常用', set:'設定',
      hasSpace:'有空位', all:'全部', lots:'停車場', street:'路邊',
      nearby:'附近車位', sortDist:'最近', sortPrice:'最便宜',
      legFree:'有位', legTight:'快滿', legFull:'滿', legUnk:'未知',
      qph:'停車場名稱、路段或行政區', qhint:'輸入關鍵字,例如「南崁」「文中路」「機場」',
      qnone:'找不到符合的地點',
      favEmpty:'還沒有常用地點。<br>在地圖上點任一個車位,詳情卡按「☆ 常用」就會加進來。',
      favAdd:'☆ 常用', favOn:'★ 常用', remove:'移除',
      appleMap:'Apple 地圖', googleMap:'Google 地圖',
      spaces:'空位', unknown:'未知', unknownSrc:'來源未提供',
      pickHint:'點地圖選擇位置', located:'已定位',
      locFail:'拿不到定位。長按定位鈕可以改成在地圖上手動指定。',
      pickTip:'點地圖上任一點設定你的位置',
      noneNear:'附近 5 公里內沒有符合的地點。<br>試試切到「全部」,或把地圖移到別的地方。',
      offline:'離線:顯示先前存下的資料', srcBad:'這些來源沒抓到最新:',
      taipei:'台北', ntpc:'新北', tyc:'桃園',
      changelog:'更新日誌', community:'社群討論', anon:'可匿名 Anonymous',
      report:'私下回報', priv:'不公開 Private',
      appName:'停哪裡', appSub:'北北桃即時車位地圖,不用登入、不用付費',
      srcNote:'資料來源:臺北市、新北市、桃園市政府開放資料平臺',
      setData:'資料狀態', setSrc:'各來源', setAbout:'關於', setAttr:'資料來源',
      lastUpd:'本機最後更新', total:'地點總數', withAv:'有即時空位', genAt:'來源產生時間',
      version:'版本', coverage:'涵蓋範圍', notYet:'尚未取得', noData:'沒有資料',
      cover:'臺北 · 新北 · 桃園', min:' 分',
      lPriv:'隱私', lTerms:'條款', lSup:'支援', lSrc:'資料來源'
    },
    en: {
      near:'Nearby', search:'Search', fav:'Saved', set:'Settings',
      hasSpace:'Available', all:'All', lots:'Car parks', street:'On-street',
      nearby:'Nearby parking', sortDist:'Closest', sortPrice:'Cheapest',
      legFree:'Free', legTight:'Filling', legFull:'Full', legUnk:'Unknown',
      qph:'Car park, street or district', qhint:'Try a place name, e.g. "Nankan", "Airport"',
      qnone:'No matching places',
      favEmpty:'No saved places yet.<br>Tap a parking spot on the map, then tap "☆ Save".',
      favAdd:'☆ Save', favOn:'★ Saved', remove:'Remove',
      appleMap:'Apple Maps', googleMap:'Google Maps',
      spaces:'free', unknown:'Unknown', unknownSrc:'not provided',
      pickHint:'Tap the map to set your location', located:'Location set',
      locFail:'Could not get your location. Press and hold the locate button to pick a spot.',
      pickTip:'Tap anywhere on the map to set your location',
      noneNear:'Nothing matching within 5 km.<br>Try "All", or move the map elsewhere.',
      offline:'Offline: showing saved data', srcBad:'Not updated: ',
      taipei:'Taipei', ntpc:'New Taipei', tyc:'Taoyuan',
      changelog:'What’s new', community:'Community', anon:'Anonymous',
      report:'Private report', priv:'Private',
      appName:'Taiwan Parking', appSub:'Live parking for northern Taiwan. No login, no purchase.',
      srcNote:'Data: Taipei, New Taipei & Taoyuan open data platforms',
      setData:'Data status', setSrc:'Sources', setAbout:'About', setAttr:'Attribution',
      lastUpd:'Last updated on device', total:'Places', withAv:'With live availability',
      genAt:'Generated at', version:'Version', coverage:'Coverage',
      notYet:'Not fetched yet', noData:'No data',
      cover:'Taipei · New Taipei · Taoyuan', min:' min',
      lPriv:'', lTerms:'', lSup:'', lSrc:''
    }
  };
  function t(k) { var v = I18N[lang] && I18N[lang][k]; return v == null ? I18N.zh[k] : v; }
  function cityName(c) { return c === '北' ? t('taipei') : c === '新' ? t('ntpc') : t('tyc'); }

  /* ────────── 小工具 ────────── */
  function dist(a1, o1, a2, o2) {
    var R = 6371000, r = Math.PI / 180;
    var dA = (a2 - a1) * r, dO = (o2 - o1) * r;
    var x = Math.sin(dA/2)*Math.sin(dA/2) + Math.cos(a1*r)*Math.cos(a2*r)*Math.sin(dO/2)*Math.sin(dO/2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  function fmtD(m) { return m < 1000 ? Math.round(m) + ' m' : (m/1000).toFixed(1) + ' km'; }
  function walk(m) { return Math.max(1, Math.round(m/80)) + t('min'); }
  /* av 為 null = 來源沒提供這項資料,不是 0 個空位。台北原始資料用 -9 表示。 */
  function cls(p) {
    if (p.av == null) return 'unk';
    if (p.av === 0) return 'zero';
    if (p.tot && p.av / p.tot < 0.12) return 'tight';
    return 'free';
  }
  function feeTxt(p) {
    if (!p.fk) return null;
    if (p.fk === 'free') return lang === 'en' ? 'Free' : '免費';
    return (p.f1 === p.f2 ? p.f1 : p.f1 + '–' + p.f2) + (p.fk === 'hour' ? ' 元/時' : ' 元/次');
  }
  function feeShort(p) {
    if (!p.fk) return null;
    if (p.fk === 'free') return lang === 'en' ? 'Free' : '免費';
    return '$' + p.f1 + (p.f1 !== p.f2 ? '+' : '');
  }
  function feeKey(p) {
    if (!p.fk) return 1e9;
    if (p.fk === 'free') return -1;
    return p.fk === 'hour' ? p.f1 : p.f1 * 0.5;
  }

  /* ────────── 資料 ────────── */
  function applyData(items, meta, cached) {
    P = items || []; META = meta || null;
    renderStale(cached); refreshPins(); renderList();
    if (curTab === 'set') renderSettings();
  }
  function loadCache() {
    var d = lsGet(LS.data);
    if (!d) return false;
    try { applyData(JSON.parse(d), JSON.parse(lsGet(LS.meta) || 'null'), true); return true; }
    catch (e) { return false; }
  }
  function fetchFresh() {
    var b = '?t=' + Math.floor(Date.now() / 60000);
    return Promise.all([
      fetch(DATA_BASE + 'parking.json' + b).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch(DATA_BASE + 'meta.json' + b).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      if (!Array.isArray(res[0]) || res[0].length < 100) throw new Error('資料異常');
      lsSet(LS.data, JSON.stringify(res[0]));
      lsSet(LS.meta, JSON.stringify(res[1]));
      lsSet(LS.at, String(Date.now()));
      applyData(res[0], res[1], false);
    });
  }
  var SRCNAME = { taipei:'臺北市停車場', ntpc_lot:'新北市停車場', ntpc_street:'新北市路邊', taoyuan:'桃園市停車場' };
  var SRCNAME_EN = { taipei:'Taipei car parks', ntpc_lot:'New Taipei car parks', ntpc_street:'New Taipei on-street', taoyuan:'Taoyuan car parks' };
  function srcName(k) { return (lang === 'en' ? SRCNAME_EN : SRCNAME)[k] || k; }
  /* 資料不新鮮要照實講:離線用舊檔、或某個來源掛掉用了快取,都要讓使用者看到。 */
  function renderStale(cached) {
    var el = $('stale'), msgs = [];
    if (cached) {
      var at = parseInt(lsGet(LS.at) || '0', 10);
      var mins = at ? Math.round((Date.now() - at) / 60000) : null;
      msgs.push(t('offline') + (mins == null ? '' : ' (' + mins + t('min') + ')'));
    }
    if (META && META.sources) {
      var bad = [];
      Object.keys(META.sources).forEach(function (k) {
        if (!META.sources[k].ok) bad.push(srcName(k));
      });
      if (bad.length) msgs.push(t('srcBad') + bad.join('、'));
    }
    if (msgs.length) { el.textContent = '⚠︎ ' + msgs.join(' · '); el.hidden = false; }
    else el.hidden = true;
  }

  /* ────────── 地圖 ────────── */
  function initMap() {
    var saved = null;
    try { saved = JSON.parse(lsGet(LS.me) || 'null'); } catch (e) {}
    if (saved && saved.lat) me = { lat: saved.lat, lon: saved.lon };
    map = L.map('map', { zoomControl: false, tap: true }).setView([me.lat, me.lon], HOME.z);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 19, minZoom: 9, attribution: '&copy; OpenStreetMap' }).addTo(map);
    layer = L.layerGroup().addTo(map);
    meMarker = L.marker([me.lat, me.lon], {
      icon: L.divIcon({ className:'', html:'<div class="me" style="width:16px;height:16px"></div>',
                        iconSize:[16,16], iconAnchor:[8,8] }),
      zIndexOffset: 1000, interactive: false
    }).addTo(map);
    map.on('moveend zoomend', refreshPins);
    map.on('click', function (e) {
      if (picking) { setMe(e.latlng.lat, e.latlng.lng); setPicking(false); }
      else closeSheet();
    });
  }
  function setMe(lat, lon) {
    me = { lat: lat, lon: lon };
    lsSet(LS.me, JSON.stringify(me));
    if (meMarker) meMarker.setLatLng([lat, lon]);
    refreshPins(); renderList();
  }
  function setPicking(on) {
    picking = on; $('pickHint').hidden = !on; $('locBtn').classList.toggle('on', on);
  }
  function visible() {
    if (!map || !P.length) return [];
    var b = map.getBounds(), out = [];
    for (var i = 0; i < P.length; i++) {
      var p = P[i];
      if (filterKind !== 'all' && p.k !== filterKind) continue;
      if (filterAvail === 'free' && !(p.av > 0)) continue;
      if (p.lat < b.getSouth() || p.lat > b.getNorth() || p.lon < b.getWest() || p.lon > b.getEast()) continue;
      out.push(p);
    }
    out.sort(function (a, c) { return (c.av == null ? -1 : c.av) - (a.av == null ? -1 : a.av); });
    return out;
  }
  function refreshPins() {
    if (!map) return;
    layer.clearLayers(); HIT = [];
    var z = map.getZoom(), list = visible(), n = Math.min(list.length, MAX_PINS);
    var mode = z < 14 ? 'dot' : (z < 16 ? 'one' : 'two');
    for (var i = 0; i < n; i++) {
      var p = list[i], k = cls(p), html, w, h;
      if (mode === 'dot') {
        var r = k === 'unk' ? 8 : Math.min(20, 9 + Math.sqrt(Math.max(0, p.av || 0)) * 1.6);
        var cv = k === 'zero' ? 'full' : (k === 'unk' ? 'unknown' : k);
        html = '<div class="dot" style="width:' + r + 'px;height:' + r + 'px;background:var(--' + cv + ')"></div>';
        w = r; h = r;
      } else {
        var f = feeShort(p) || '—', two = (mode === 'two');
        html = '<div class="pin ' + k + (p === sel ? ' sel' : '') + '"><span class="p1">' + esc(f) + '</span>' +
          (two ? '<span class="p2">' + (p.av == null ? t('unknown') : p.av) + '</span>' : '') + '</div>';
        w = Math.max(38, String(f).length * 8 + 14); h = two ? 32 : 22;
      }
      var m = L.marker([p.lat, p.lon], {
        icon: L.divIcon({ className:'', html: html, iconSize:[w,h], iconAnchor:[w/2,h/2] })
      });
      (function (pp) { m.on('click', function (ev) { L.DomEvent.stop(ev); openSheet(pp); }); })(p);
      m.addTo(layer);
    }
  }

  /* ────────── 詳情卡 ────────── */
  function navUrls(p) {
    var ll = p.lat.toFixed(6) + ',' + p.lon.toFixed(6);
    return { apple:'https://maps.apple.com/?daddr=' + ll + '&dirflg=d',
             google:'https://www.google.com/maps/dir/?api=1&destination=' + ll + '&travelmode=driving' };
  }
  function openSheet(p) {
    if (sheetState !== 'off') beforeDetail = sheetState;
    setSheet('off');
    sel = p; refreshPins();
    var k = cls(p), d = dist(me.lat, me.lon, p.lat, p.lon), u = navUrls(p), ft = feeTxt(p);
    var av = p.av == null
      ? '<span class="n">' + t('unknown') + '</span><div class="t">' + t('unknownSrc') + '</div>'
      : '<span class="n">' + p.av + '</span><div class="t">' + (p.tot ? '/ ' + p.tot : t('spaces')) + '</div>';
    $('sheetBody').innerHTML =
      '<button class="sh-close" id="shClose" aria-label="close">✕</button>' +
      '<div class="sh-top"><div class="sh-name">' + esc(p.n || '') + '</div>' +
      '<div class="sh-av ' + k + '">' + av + '</div></div>' +
      '<div class="chips">' +
        '<span class="chip">' + esc(cityName(p.c)) + '</span>' +
        (p.k === 'street' ? '<span class="chip">' + t('street') + '</span>' : '') +
        (p.a ? '<span class="chip">' + esc(p.a) + '</span>' : '') +
        (ft ? '<span class="chip ' + (p.fk === 'free' ? 'fee0' : 'fee') + '">' + esc(ft) + '</span>' : '') +
      '</div>' +
      '<div class="sh-meta">' + fmtD(d) + ' · ' + walk(d) + (p.r ? '<br>' + esc(p.r) : '') + '</div>' +
      '<div class="navrow">' +
        '<a class="navbtn" data-ext href="' + u.apple + '">' + t('appleMap') + '</a>' +
        '<a class="navbtn alt" data-ext href="' + u.google + '">' + t('googleMap') + '</a>' +
        '<button class="favbtn' + (isFav(p) ? ' on' : '') + '" id="favToggle">' +
          (isFav(p) ? t('favOn') : t('favAdd')) + '</button>' +
      '</div>';
    $('sheet').hidden = false;
    $('shClose').addEventListener('click', function (e) { e.stopPropagation(); closeSheet(); });
    $('sheetBody').querySelectorAll('[data-ext]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var w = null;
        try { w = window.open(a.href, '_blank'); } catch (err) {}
        if (!w) location.href = a.href;
      });
    });
    $('favToggle').addEventListener('click', function (e) {
      e.stopPropagation();
      var on = toggleFav(p);
      this.classList.toggle('on', on);
      this.textContent = on ? t('favOn') : t('favAdd');
    });
  }
  function closeSheet() {
    sel = null; $('sheet').hidden = true;
    setSheet(beforeDetail === 'off' ? 'peek' : beforeDetail);
    refreshPins();
  }

  /* ────────── 可拖曳的底部清單 ────────── */
  var PEEK = 78;
  function paneH() { return $('listPane').getBoundingClientRect().height; }
  function offsetFor(st) {
    var H = paneH();
    if (st === 'full') return 0;
    if (st === 'half') return Math.round(H * 0.46);
    if (st === 'off') return H;
    return Math.max(0, H - PEEK);
  }
  function setSheet(st, noAnim) {
    sheetState = st;
    var pane = $('listPane');
    pane.classList.toggle('peek', st === 'peek');
    pane.classList.toggle('off', st === 'off');
    if (noAnim) pane.classList.add('dragging');
    pane.style.transform = 'translateY(' + offsetFor(st) + 'px)';
    if (noAnim) requestAnimationFrame(function () { pane.classList.remove('dragging'); });
    if (st !== 'peek' && st !== 'off') renderList();
  }
  function initSheetDrag() {
    var pane = $('listPane'), startOff = null, startY = 0, moved = 0, curY = 0;
    function begin(y, target) {
      if (target && target.closest && target.closest('button')) return false;
      startOff = offsetFor(sheetState); curY = startOff; startY = y; moved = 0;
      pane.classList.add('dragging'); return true;
    }
    function move(y) {
      if (startOff == null) return;
      var dy = y - startY; moved = Math.max(moved, Math.abs(dy));
      var H = paneH();
      curY = Math.min(Math.max(0, startOff + dy), Math.max(0, H - PEEK));
      pane.style.transform = 'translateY(' + curY + 'px)';
    }
    function end() {
      if (startOff == null) return;
      pane.classList.remove('dragging');
      if (moved < 8) setSheet(sheetState === 'peek' ? 'half' : 'peek');
      else {
        var best = 'peek', bd = Infinity;
        ['full','half','peek','off'].forEach(function (st) {
          var d = Math.abs(offsetFor(st) - curY);
          if (d < bd) { bd = d; best = st; }
        });
        setSheet(best);
      }
      startOff = null;
    }
    /* 🔴 用 touch 事件,不要用 pointer:iOS Safari 判定為頁面手勢時會送 pointercancel,
       而且把 capture 設在父層、監聽器掛子元素的話,子元素永遠收不到 move/up。 */
    function ts(e) { if (e.touches.length === 1 && begin(e.touches[0].clientY, e.target)) e.preventDefault(); }
    function tm(e) { if (startOff != null) { e.preventDefault(); move(e.touches[0].clientY); } }
    ['#grip', '.listhead'].forEach(function (q) {
      var el = pane.querySelector(q);
      if (!el) return;
      el.addEventListener('touchstart', ts, { passive:false });
      el.addEventListener('touchmove', tm, { passive:false });
      el.addEventListener('touchend', end);
      el.addEventListener('touchcancel', end);
      el.addEventListener('mousedown', function (e) {
        if (!begin(e.clientY, e.target)) return;
        e.preventDefault();
        function mm(ev) { move(ev.clientY); }
        function mu() { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); end(); }
        window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
      });
    });
    window.addEventListener('resize', function () { setSheet(sheetState, true); });
    setSheet('peek', true);
  }

  /* ────────── 清單 ────────── */
  function rowHtml(p, extra) {
    var k = cls(p), ft = feeShort(p);
    return '<div class="row"' + (extra || '') + '>' +
      '<div class="rmain"><div class="rn">' + esc(p.n || '') + '</div>' +
      '<div class="rm">' + (ft ? '<span>' + esc(ft) + '</span>' : '') +
      (p.a ? '<span>' + esc(p.a) + '</span>' : '') +
      (p.k === 'street' ? '<span>' + t('street') + '</span>' : '') + '</div></div>' +
      '<div class="rav ' + k + '"><b>' + (p.av == null ? t('unknown') : p.av) + '</b>' +
      (p.tot ? '<span class="rd"> / ' + p.tot + '</span>' : '') +
      '<div class="rd">' + fmtD(p._d) + ' · ' + walk(p._d) + '</div></div></div>';
  }
  function renderList() {
    if (!P.length) return;
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
    $('listCount').textContent = near.length ? '· ' + near.length : '';
    var body = $('listBody');
    if (!near.length) { body.innerHTML = '<div class="empty">' + t('noneNear') + '</div>'; return; }
    body.innerHTML = near.map(function (p, j) { return rowHtml(p, ' data-j="' + j + '"'); }).join('');
    body.querySelectorAll('.row').forEach(function (el) {
      el.addEventListener('click', function () {
        var p = near[parseInt(el.dataset.j, 10)];
        map.setView([p.lat, p.lon], Math.max(map.getZoom(), 16));
        openSheet(p);
      });
    });
  }

  /* ────────── 常用 ────────── */
  function favKey(p) { return p.c + '|' + p.k + '|' + p.n + '|' + p.lat.toFixed(4); }
  function favList() { try { return JSON.parse(lsGet(LS.fav) || '[]'); } catch (e) { return []; } }
  function isFav(p) { var k = favKey(p); return favList().some(function (x) { return x.key === k; }); }
  function toggleFav(p) {
    var k = favKey(p), arr = favList();
    var i = -1;
    for (var j = 0; j < arr.length; j++) if (arr[j].key === k) { i = j; break; }
    if (i >= 0) arr.splice(i, 1);
    else arr.push({ key:k, n:p.n, c:p.c, a:p.a, lat:p.lat, lon:p.lon });
    lsSet(LS.fav, JSON.stringify(arr));
    return i < 0;
  }
  function findByKey(k) { for (var i = 0; i < P.length; i++) if (favKey(P[i]) === k) return P[i]; return null; }
  function renderFav() {
    var arr = favList(), el = $('favBody');
    if (!arr.length) { el.innerHTML = '<div class="empty">' + t('favEmpty') + '</div>'; return; }
    el.innerHTML = arr.map(function (f, i) {
      var live = findByKey(f.key);
      var p = live || { n:f.n, c:f.c, a:f.a, lat:f.lat, lon:f.lon, av:null, tot:null, k:'lot' };
      p._d = dist(me.lat, me.lon, f.lat, f.lon);
      return rowHtml(p, ' data-k="' + esc(f.key) + '" data-i="' + i + '"');
    }).join('');
    el.querySelectorAll('.row').forEach(function (r) {
      r.addEventListener('click', function () {
        var p = findByKey(r.dataset.k);
        if (!p) { toast(t('noData')); return; }
        switchTab('near'); map.setView([p.lat, p.lon], 16); openSheet(p);
      });
    });
  }

  /* ────────── 搜尋 ────────── */
  function runSearch() {
    var q = ($('q').value || '').trim(), box = $('qres');
    if (!q) { box.innerHTML = ''; $('qhint').textContent = t('qhint'); return; }
    var hit = [];
    for (var i = 0; i < P.length && hit.length < 200; i++) {
      var p = P[i];
      if ((p.n && p.n.indexOf(q) >= 0) || (p.a && p.a.indexOf(q) >= 0)) {
        p._d = dist(me.lat, me.lon, p.lat, p.lon); hit.push(p);
      }
    }
    hit.sort(function (a, b) { return a._d - b._d; });
    hit = hit.slice(0, 60);
    $('qhint').textContent = hit.length ? hit.length : t('qnone');
    box.innerHTML = hit.map(function (p, j) { return rowHtml(p, ' data-j="' + j + '"'); }).join('');
    box.querySelectorAll('.row').forEach(function (r) {
      r.addEventListener('click', function () {
        var p = hit[parseInt(r.dataset.j, 10)];
        switchTab('near'); map.setView([p.lat, p.lon], 16); openSheet(p);
      });
    });
  }

  /* ────────── 設定 ────────── */
  function legalUrl(name) {
    /* 🔴 法務頁是純 HTML,沒有版本戳,而 GitHub Pages 給 10 分鐘快取、
       Service Worker 也會存一份 —— 改了內容使用者卻還看到舊版(他因此回報
       「資料來源沒有其他分頁連結」,其實新版早就有了)。帶上 build 戳就永遠是最新。 */
    return LEGAL + name + '.html?v=' + buildStamp();
  }
  function buildStamp() {
    var sc = document.querySelector('script[src*="app.js"]');
    var m = sc && /[?&]v=(\d+)/.exec(sc.src);
    return m ? m[1] : '—';
  }
  /* 比照 Jetstream:版號旁邊顯示這一包自己的部署碼,修 bug 不跳版號,
     要確認是不是最新版就看這串(Dominic 2026-09-28)。
     🔴 讀的是自己 script 網址上的戳記,不是去問伺服器 —— 伺服器已經推新版
        但這台還沒載到時,問伺服器會得到錯的答案。 */
  function deployCode() {
    var b = buildStamp();
    return /^\d{14}$/.test(b) ? b.slice(4, 8) + '-' + b.slice(8, 12) : b;
  }
  function isStandalone() {
    return (window.navigator.standalone === true) ||
           (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }
  function renderSettings() {
    var at = parseInt(lsGet(LS.at) || '0', 10);
    var h = '<div class="card2"><h2>' + t('setData') + '</h2>' +
      '<div class="kv"><span>' + t('lastUpd') + '</span><span>' +
        (at ? new Date(at).toLocaleString(lang === 'en' ? 'en-GB' : 'zh-TW', { hour12:false }) : t('notYet')) + '</span></div>' +
      '<div class="kv"><span>' + t('total') + '</span><span>' + P.length.toLocaleString() + '</span></div>' +
      '<div class="kv"><span>' + t('withAv') + '</span><span>' +
        P.filter(function (p) { return p.av != null; }).length.toLocaleString() + '</span></div>' +
      (META && META.generated ? '<div class="kv"><span>' + t('genAt') + '</span><span>' +
        esc(META.generated.replace('T',' ').slice(0,16)) + '</span></div>' : '') +
      '</div>';
    if (META && META.sources) {
      h += '<div class="card2"><h2>' + t('setSrc') + '</h2>';
      Object.keys(META.sources).forEach(function (k) {
        var s = META.sources[k];
        h += '<div class="kv"><span><i class="okdot ' + (s.ok ? 'y' : 'n') + '"></i>' + esc(srcName(k)) + '</span><span>' +
          (s.ok ? (s.count || 0) : (s.stale ? s.ageMin + t('min') : t('noData'))) + '</span></div>';
      });
      h += '</div>';
    }
    h += '<div class="card2"><h2>' + t('setAttr') + '</h2><p>' + esc(t('srcNote')) +
      '<br>© OpenStreetMap' +
      '<br><br>⚠︎ ' + (lang === 'en'
        ? 'Unknown means the source did not provide the value, not that there are no spaces.'
        : '空位顯示「未知」代表來源沒有提供,不是沒有空位。') +
      '<br>⚠︎ ' + (lang === 'en'
        ? 'On-street status codes for New Taipei are not yet confirmed; treat those numbers as indicative.'
        : '新北市路邊車格的狀態碼含意尚未確認,那些數字請當作參考。') + '</p></div>';
    h += '<div class="card2"><h2>' + t('setAbout') + '</h2>' +
      '<div class="kv"><span>' + t('version') + '</span><span>' + VERSION + '</span></div>' +
      '<div class="kv"><span>' + t('coverage') + '</span><span>' + t('cover') + '</span></div>' +
      '<div class="kv"><span>deploy</span><span>' + esc(deployCode()) + '</span></div>' +
      '<div class="kv"><span>build</span><span>' + esc(buildStamp()) + '</span></div>' +
      '<div class="kv"><span>模式</span><span>' + (isStandalone() ? 'PWA' : 'Safari') + '</span></div>' +
      '<div class="kv"><span>Service Worker</span><span>' +
        (('serviceWorker' in navigator) ? (navigator.serviceWorker.controller ? '✅' : '未接管') : '不支援') +
      '</span></div></div>';
    $('setBody').innerHTML = h;
  }

  /* ────────── 更新日誌 ────────── */
  var CHANGELOG = [
    { v:'0.3.0', d:'2026-09-28', items:[
      ['新增隱私權政策與服務條款。', 'Added privacy policy and terms of service.']
    ]},
    { v:'0.2.0', d:'2026-09-28', items:[
      ['新增地點搜尋。', 'You can now search for places.'],
      ['新增常用地點。', 'You can now save places.'],
      ['新增英文介面。', 'English is now available.']
    ]},
    { v:'0.1.0', d:'2026-09-28', items:[
      ['北北桃即時車位地圖。', 'Live parking map for northern Taiwan.']
    ]}
  ];
  function reportMailto() {
    var L2 = [];
    L2.push(lang === 'en' ? '(Describe the problem here. Diagnostics below.)' : '(請在這裡描述問題,下面是診斷資訊,可自行刪除)');
    L2.push(''); L2.push('---');
    L2.push('App: 停哪裡 / Taiwan Parking v' + VERSION + '  lang=' + lang);
    var at = parseInt(lsGet(LS.at) || '0', 10);
    L2.push('Fetched: ' + (at ? new Date(at).toISOString() : 'n/a'));
    if (META && META.generated) L2.push('Generated: ' + META.generated);
    L2.push('Places: ' + P.length);
    if (META && META.sources) Object.keys(META.sources).forEach(function (k) {
      var s = META.sources[k];
      L2.push('  ' + k + ': ' + (s.ok ? 'ok ' + s.count : 'FAIL ' + (s.error || '')));
    });
    if (map) { var c = map.getCenter(); L2.push('Map: ' + c.lat.toFixed(5) + ',' + c.lng.toFixed(5) + ' z' + map.getZoom()); }
    if (sel) L2.push('Viewing: ' + (sel.n || ''));
    L2.push('UA: ' + (navigator.userAgent || '').slice(0, 120));
    return 'mailto:' + SUPPORT_MAIL +
      '?subject=' + encodeURIComponent((lang === 'en' ? 'Taiwan Parking report v' : '停哪裡 回報 v') + VERSION) +
      '&body=' + encodeURIComponent(L2.join('\n'));
  }
  function openAbout() {
    var ov = $('aboutOv');
    ov.innerHTML =
      '<div class="ovcard">' +
        '<div class="ovtop">' +
          '<div class="ovhead"><img src="icons/icon-192.png" alt="">' +
            '<strong>' + t('appName') + '</strong>' +
            '<button type="button" class="x" id="aboutClose" aria-label="close">✕</button></div>' +
          '<div class="ovsub">' + t('appSub') + '</div>' +
          '<div class="ovver">v' + VERSION + ' · deploy ' + deployCode() + '</div>' +
          (STALE ? '<div class="stalenote">⚠ ' + esc(STALE) + '</div>' : '') +
          '<div class="lang2">' +
            '<button type="button" id="clZh" class="' + (lang === 'zh' ? 'on' : '') + '">中文</button>' +
            '<button type="button" id="clEn" class="' + (lang === 'en' ? 'on' : '') + '">EN</button></div>' +
          /* 社群(公開、可匿名)與私下回報各一半 —— 文字與配色跟家族一字不差,
             唯一差別是這個 App 沒有後端,右邊那顆走 mailto。 */
          '<div class="rep2">' +
            '<a class="comm" data-ext href="' + LINE_URL + '">💬 ' + t('community') +
              '<div class="sub2">' + t('anon') + '</div></a>' +
            '<a class="priv" href="' + reportMailto() + '">🔒 ' + t('report') +
              '<div class="sub2">' + t('priv') + '</div></a></div>' +
        '</div>' +
        '<div class="ovbody">' + CHANGELOG.map(function (c) {
          return '<div class="cl"><span class="v">v' + c.v + '</span><span class="d">' + c.d + '</span><ul>' +
            c.items.map(function (it) { return '<li>' + esc(lang === 'en' ? it[1] : it[0]) + '</li>'; }).join('') +
            '</ul></div>';
        }).join('') + '</div>' +
        '<div class="ovfoot">' +
          '<a href="' + legalUrl('privacy') + '" data-ext>Privacy ' + t('lPriv') + '</a>' +
          '<a href="' + legalUrl('terms') + '" data-ext>Terms ' + t('lTerms') + '</a>' +
          '<a href="' + legalUrl('support') + '" data-ext>Support ' + t('lSup') + '</a>' +
          '<a href="' + legalUrl('sources') + '" data-ext>Sources ' + t('lSrc') + '</a>' +
        '</div>' +
      '</div>';
    $('aboutClose').addEventListener('click', function () { ov.hidden = true; });
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.hidden = true; });
    /* 🔴 加到主畫面的 standalone PWA 裡,target="_blank" 是死的(不開新分頁也不導航)。
       改成自己開:先試 window.open,失敗就同頁導航(法務頁上有「回到 App」)。 */
    ov.querySelectorAll('[data-ext]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var w = null;
        try { w = window.open(a.href, '_blank'); } catch (err) {}
        if (!w) location.href = a.href;
      });
    });
    $('clZh').addEventListener('click', function () { applyLang('zh'); openAbout(); });
    $('clEn').addEventListener('click', function () { applyLang('en'); openAbout(); });
    ov.hidden = false;
  }

  /* ────────── 底列:語言 / 日夜 / 字級 / 版號 ────────── */
  function applyLang(l) {
    lang = (l === 'en') ? 'en' : 'zh';
    lsSet(LS.lang, lang);
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant';
    var seg = $('hp-lang'); if (seg) seg.setAttribute('data-lang', lang);
    document.querySelectorAll('.hp-tab-btn').forEach(function (b) {
      var ic = b.querySelector('.hp-tab-icon');
      b.textContent = ''; if (ic) b.appendChild(ic);
      b.appendChild(document.createTextNode(t(b.dataset.hp)));
    });
    var H = { 'pane-search':'search', 'pane-fav':'fav', 'pane-set':'set' };
    Object.keys(H).forEach(function (id) {
      var h = document.querySelector('#' + id + ' h1'); if (h) h.textContent = t(H[id]);
    });
    var F = { free:'hasSpace', all:'all' }, K = { all:'all', lot:'lots', street:'street' },
        S = { dist:'sortDist', price:'sortPrice' };
    document.querySelectorAll('[data-filter]').forEach(function (b) { b.textContent = t(F[b.dataset.filter]); });
    document.querySelectorAll('[data-kind]').forEach(function (b) { b.textContent = t(K[b.dataset.kind]); });
    document.querySelectorAll('[data-sort]').forEach(function (b) { b.textContent = t(S[b.dataset.sort]); });
    var lg = $('legend');
    if (lg) ['legFree','legTight','legFull','legUnk'].forEach(function (key, i) {
      var sp = lg.querySelectorAll('span')[i], ic = sp.querySelector('i');
      sp.innerHTML = ''; if (ic) sp.appendChild(ic);
      sp.appendChild(document.createTextNode(t(key)));
    });
    $('listTitle').textContent = t('nearby');
    $('pickHint').textContent = t('pickHint');
    var qi = $('q'); if (qi) qi.placeholder = t('qph');
    if (!(qi && qi.value.trim())) $('qhint').textContent = t('qhint');
    renderList(); renderStale(false);
    if (curTab === 'fav') renderFav();
    if (curTab === 'set') renderSettings();
    if (curTab === 'search') runSearch();
    refreshPins();
  }
  /* 家族規格:只有兩段,預設深色,[data-theme="light"] 才是亮色(浮標靠它驅動)。 */
  function applyTheme(v) {
    v = (v === 'light') ? 'light' : 'dark';
    if (v === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    lsSet(LS.theme, v);
    if (map) setTimeout(refreshPins, 30);
  }
  /* 家族字級:20 段,n ∈ [-2, 17],fontSize = (100 + n×8)%。全家族統一。 */
  var FONT_MIN = -2, FONT_MAX = 17;
  function fontN() { var n = parseInt(lsGet(LS.font), 10); return isFinite(n) ? Math.max(FONT_MIN, Math.min(FONT_MAX, n)) : 0; }
  function applyFontN(n) {
    n = Math.max(FONT_MIN, Math.min(FONT_MAX, n));
    lsSet(LS.font, String(n));
    document.documentElement.style.fontSize = (100 + n * 8) + '%';
    if (map) setTimeout(function () { map.invalidateSize(); refreshPins(); }, 60);
  }
  function adjustFont(d) { applyFontN(fontN() + d); }

  /* ────────── 分頁 ────────── */
  function switchTab(id) {
    curTab = id;
    ['near','search','fav','set'].forEach(function (k) {
      var pane = $('pane-' + k); if (pane) pane.classList.toggle('on', k === id);
    });
    document.querySelectorAll('.hp-tab-btn').forEach(function (b) {
      b.classList.toggle('hp-active', b.dataset.hp === id);
    });
    if (id === 'near' && map) setTimeout(function () { map.invalidateSize(); }, 60);
    if (id === 'fav') renderFav();
    if (id === 'set') renderSettings();
    if (id === 'search') setTimeout(function () { var q = $('q'); if (q) q.focus(); }, 80);
  }

  /* ────────── 定位 ────────── */
  function locate() {
    var Geo = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation) || null;
    function ok(lat, lon) { setMe(lat, lon); map.setView([lat, lon], Math.max(map.getZoom(), 15)); toast(t('located')); }
    function fail() { toast(t('locFail'), 3600); }
    if (Geo && Geo.getCurrentPosition) {
      Geo.requestPermissions().catch(function () { return null; })
        .then(function () { return Geo.getCurrentPosition({ enableHighAccuracy:true, timeout:12000 }); })
        .then(function (p) { ok(p.coords.latitude, p.coords.longitude); }).catch(fail);
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(function (p) { ok(p.coords.latitude, p.coords.longitude); },
        fail, { enableHighAccuracy:true, timeout:12000 });
    } else fail();
  }

  /* ────────── 綁定 ────────── */
  function bind() {
    document.querySelectorAll('[data-filter]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('[data-filter]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); filterAvail = b.dataset.filter; refreshPins(); renderList();
      });
    });
    document.querySelectorAll('[data-kind]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('[data-kind]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); filterKind = b.dataset.kind; refreshPins(); renderList();
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
    ['pointerup','pointerleave','pointercancel'].forEach(function (ev) {
      lb.addEventListener(ev, function () { clearTimeout(holdT); });
    });
    initSheetDrag();

    var bar = $('hp-tabbar');
    bar.addEventListener('click', function (e) {
      /* 🔴 功能區是「換設定」不是「點到別處」—— 擋掉冒泡,不然每切一次就關掉開著的面板。 */
      if (e.target.closest && e.target.closest('.hp-tab-util')) e.stopPropagation();
      var lg = e.target.closest('.hp-lang-opt');   if (lg) { applyLang(lg.dataset.lg); return; }
      var th = e.target.closest('.hp-theme-opt');  if (th) { applyTheme(th.dataset.th); return; }
      var fb = e.target.closest('.hp-font-btn');   if (fb) { adjustFont(Number(fb.dataset.fd)); return; }
      if (e.target.id === 'hp-ver') { openAbout(); return; }
      var btn = e.target.closest('.hp-tab-btn');   if (btn) switchTab(btn.dataset.hp);
    });
    bar.addEventListener('keydown', function (e) {
      if (e.target && e.target.id === 'hp-ver' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openAbout(); }
    });
    $('hp-ver').textContent = 'v' + VERSION;

    var qi = $('q'), qt = null;
    qi.addEventListener('input', function () { clearTimeout(qt); qt = setTimeout(runSearch, 160); });
    qi.addEventListener('search', runSearch);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) fetchFresh().catch(function () {});
    });
  }

  /* GitHub Pages 的 HTML 帶 max-age=600,手機會載到舊的 index.html(連帶舊的 app.js)。
     開機比對伺服器上的 build 戳記,不一樣就自己重載一次。 */
  /* 比照 Jetstream:手上這包不是最新版就把版號變琥珀色並說「關掉重開更新」。
     🔴 只比**部署碼**,不要連版號一起比 —— 形狀不同會變成永遠亮、而且重開也不消失
        (Jetstream 2026-09-05 同一個坑踩過兩次)。
     🔴 用行內樣式,不要只靠 class —— 這支的前提就是「舊的 CSS 可能還在」,
        靠 class 會在唯一需要它的時候不亮。
     🔴 讀的是**這一包自己的**戳記,不是去問伺服器現在跑哪一版。 */
  var STALE = null;   // 手上這包過期時的說明;title 在手機上看不到,所以也要進更新日誌卡片
  function markStale(mine, latest) {
    var el = $('hp-ver');
    if (!el) return;
    el.textContent = '⚠ v' + VERSION;
    el.style.cssText += ';color:#3b1d00;background:#f59e0b;opacity:1;padding:1px 6px;'
      + 'border-radius:5px;text-decoration:none;font-weight:700';
    STALE = lang === 'en'
      ? 'This device loaded ' + mine + '; server has ' + latest + ' — close and reopen to update'
      : '這台載到的是 ' + mine + ',伺服器是 ' + latest + ' —— 關掉重開更新';
    el.title = STALE;
  }
  function selfUpdate() {
    var mine = buildStamp();
    if (!/^\d{14}$/.test(mine)) return;
    fetch('build.txt?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (txt) {
        if (!txt) return;                        // 離線:就顯示手上這版,不要亂警告
        var latest = txt.trim();
        if (!/^\d{14}$/.test(latest) || latest === mine) return;
        var tried = 0;
        try { tried = parseInt(sessionStorage.getItem('pk.reload') || '0', 10) || 0; } catch (e) {}
        if (tried >= 2) {
          /* 重載兩次還是舊的 —— 多半是 iOS 的 standalone PWA 把舊殼黏住了,
             重載救不回來。這時候就照家族做法:講出來,讓使用者關掉重開。 */
          markStale(mine, latest);
          return;
        }
        try { sessionStorage.setItem('pk.reload', String(tried + 1)); } catch (e) {}
        location.replace(location.pathname + '?b=' + latest);
      })
      .catch(function () { /* 離線:不警告 */ });
  }

  function boot() {
    applyTheme(lsGet(LS.theme) || 'dark');
    applyFontN(fontN());
    initMap();
    bind();
    switchTab('near');
    applyLang(lsGet(LS.lang) || (/^zh/i.test(navigator.language || '') ? 'zh' : 'en'));
    var had = loadCache();
    fetchFresh().catch(function () {
      if (!had) toast(lang === 'en' ? 'Could not load data and nothing is saved locally.' : '連不上資料來源,而且本機沒有存檔。', 5000);
    });
    setInterval(function () { fetchFresh().catch(function () {}); }, 5 * 60 * 1000);
    selfUpdate();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
      /* 新版 SW 接管 → 重載一次(有旗標防止無限迴圈) */
      navigator.serviceWorker.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'pk-updated') {
          var n = 0;
          try { n = parseInt(sessionStorage.getItem('pk.swreload') || '0', 10) || 0; } catch (err) {}
          if (n >= 2) return;
          try { sessionStorage.setItem('pk.swreload', String(n + 1)); } catch (err) {}
          location.reload();
        }
      });
      // 每次回到前景檢查一次有沒有新版 SW
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) navigator.serviceWorker.getRegistration().then(function (r) { if (r) r.update(); }).catch(function () {});
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
