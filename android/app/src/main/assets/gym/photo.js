/* Gym Companion — on-device photo character.
 *
 * The full-body picture never leaves the phone: it is cropped into the portrait frame on the device,
 * stored in a small on-device IndexedDB (never the private server or localStorage), and only included
 * in the JSON backup the user downloads. No upload, no server endpoint, no background removal.
 */
(function () {
  'use strict';
  var global = window;
  var KEY = 'character';
  var MAX_PHOTOS = 6;
  var FRAME_W = 480, FRAME_H = 640;         // portrait frame used for the card and the timeline

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  // Photos can arrive from a restored backup file, so treat every field as untrusted.
  var IMG_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+\/=]+$/;
  function cleanPhoto(p) {
    if (!p || typeof p.img !== 'string' || !IMG_RE.test(p.img)) return null;
    return {id: String(p.id || uid()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || uid(),
      date: /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : new Date().toISOString().slice(0, 10),
      lv: Math.max(1, Math.min(50, parseInt(p.lv, 10) || 1)), score: isFinite(+p.score) ? +p.score : 0, img: p.img};
  }
  function norm(d) {
    d = d || {};
    var photos = Array.isArray(d.photos) ? d.photos.map(cleanPhoto).filter(Boolean).slice(-MAX_PHOTOS) : [];
    var cur = typeof d.current === 'string' && photos.some(function (p) { return p.id === d.current; }) ? d.current : null;
    return {mode: d.mode === 'photo' && photos.length ? 'photo' : 'cartoon', photos: photos, current: cur};
  }
  /* Private mode keeps Store.* in localStorage (~5 MB), too small for body photos. Use a small
     IndexedDB of our own in BOTH modes: still on-device only, but with room for a few photos. */
  var dbPromise = null;                       // ONE shared connection (render() runs on every home render)
  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      var r = global.indexedDB.open('gym-character', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () {
        var conn = r.result;
        conn.onclose = conn.onversionchange = function () { try { conn.close(); } catch (e) {} dbPromise = null; };
        resolve(conn);
      };
      r.onerror = function () { reject(r.error); };
    });
    dbPromise.catch(function () { dbPromise = null; });
    return dbPromise;
  }
  function data() {
    return db().then(function (connection) {
      return new Promise(function (resolve, reject) {
        var q = connection.transaction('kv', 'readonly').objectStore('kv').get(KEY);
        q.onsuccess = function () { resolve(norm(q.result)); };
        q.onerror = function () { reject(q.error); };
      });
    }).catch(function () {
      try { return norm(JSON.parse(global.localStorage.getItem('gym' + KEY) || 'null')); }
      catch (e) { return norm(null); }
    });
  }
  function save(d) {
    var v = norm(d);
    return db().then(function (connection) {
      return new Promise(function (resolve, reject) {
        var tx = connection.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, KEY);
        tx.oncomplete = function () { resolve(v); };
        tx.onerror = function () { reject(tx.error); };
      });
    }).catch(function () {
      // Fallback storage is small; if the photos don't fit, say so instead of pretending it saved.
      global.localStorage.setItem('gym' + KEY, JSON.stringify(v));   // throws QuotaExceeded -> save() rejects
      return v;
    });
  }

  function loadBitmap(file) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file, {imageOrientation: 'from-image'}).catch(function () { return createImageBitmap(file); });
    }
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
      img.src = url;
    });
  }
  /** Crop the picture into the portrait frame. view = {scale, x, y}, x/y in -1..1. */
  function portrait(src, view) {
    view = view || {};
    var scale = Math.max(1, num(view.scale, 1));
    var sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
    var k = scale * Math.max(FRAME_W / sw, FRAME_H / sh);
    var w = sw * k, h = sh * k;
    var dx = (FRAME_W - w) / 2 + num(view.x) * FRAME_W / 2;
    var dy = (FRAME_H - h) / 2 + num(view.y) * FRAME_H / 2;
    var c = document.createElement('canvas'); c.width = FRAME_W; c.height = FRAME_H;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#0c0e12'; ctx.fillRect(0, 0, FRAME_W, FRAME_H);   // JPEG has no transparency
    ctx.drawImage(src, dx, dy, w, h);
    return c;
  }
  function num(x, d) { var v = parseFloat(x); return isFinite(v) ? v : (d || 0); }

  /** Frame a picked photo as it was positioned in the editor and return {img}. */
  function frame(file, view) {
    return loadBitmap(file).then(function (bmp) {
      var out = {img: portrait(bmp, view).toDataURL('image/jpeg', 0.88)};
      if (typeof bmp.close === 'function') bmp.close();
      return out;
    });
  }

  function savePhoto(img, meta) {
    meta = meta || {};
    return data().then(function (d) {
      d.photos.push({id: uid(), date: meta.date || new Date().toISOString().slice(0, 10),
        lv: meta.lv || 1, score: meta.score || 0, img: img});
      d.photos = d.photos.slice(-MAX_PHOTOS);
      d.mode = 'photo';
      d.current = d.photos[d.photos.length - 1].id;
      return save(d);
    });
  }
  function useCartoon() { return data().then(function (d) { d.mode = 'cartoon'; return save(d); }); }
  function usePhoto(id) {
    return data().then(function (d) {
      d.mode = 'photo';
      d.current = id || (d.photos[d.photos.length - 1] || {}).id || null;
      return save(d);
    });
  }
  function current(d) {
    d = norm(d);
    for (var i = 0; i < d.photos.length; i++) if (d.photos[i].id === d.current) return d.photos[i];
    return d.photos[d.photos.length - 1] || null;
  }
  function remove(id) {
    return data().then(function (d) {
      d.photos = d.photos.filter(function (p) { return p.id !== id; });
      if (d.current === id) d.current = (d.photos[d.photos.length - 1] || {}).id || null;
      if (!d.photos.length) d.mode = 'cartoon';
      return save(d);
    });
  }

  /** Built with DOM nodes, never an HTML string: the image data may come from a restored backup. */
  function frameNode(p, lv, colour) {
    var box = document.createElement('div'); box.className = 'char-photo';
    if (/^#[0-9a-fA-F]{3,8}$/.test(String(colour))) box.style.setProperty('--tier', colour);
    var img = document.createElement('img'); img.alt = 'My character'; img.src = p.img; box.appendChild(img);
    var badge = document.createElement('span'); badge.className = 'char-badge'; badge.appendChild(document.createTextNode('LV '));
    var b = document.createElement('b'); b.textContent = String(parseInt(lv, 10) || p.lv); badge.appendChild(b); box.appendChild(badge);
    return box;
  }
  /** Draw the cartoon first, then swap in the photo if that mode is on. Safe to call often. */
  function render(el, score, lv, colour, opts) {
    if (!el) return;
    var fallback = global.Lifter && global.Lifter.svg ? global.Lifter.svg(score, opts || {}) : '';
    el.innerHTML = fallback;
    if (!global.Lifter) return;
    var token = uid(); el.__gymPhotoToken = token;
    data().then(function (d) {
      if (el.__gymPhotoToken !== token || d.mode !== 'photo') return;
      var p = current(d);
      if (p) { el.textContent = ''; el.appendChild(frameNode(p, lv, colour)); }
    }).catch(function () {});
  }

  global.GymPhoto = {
    KEY: KEY, FRAME_W: FRAME_W, FRAME_H: FRAME_H,
    data: data, saveData: save, current: current, frame: frame, render: render,
    savePhoto: savePhoto, useCartoon: useCartoon, usePhoto: usePhoto, remove: remove
  };
})();
