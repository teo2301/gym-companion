/* Gym Companion profiles (1.19): your own profile screen and the pieces friends' profiles share.
 *
 * GymProfile.open()             own profile screen (#me): training calendar (tap a day to see it, add a workout on
 *                               any past day, edit / delete that day's workouts), progress photos timeline (each photo
 *                               Public = friends can see it, or Private = this phone only), Share my stats switch.
 * GymProfile.timeline(box, items, opts)   dated photo timeline (own + friends'), newest/oldest toggle, tap to enlarge.
 * GymProfile.calList(workouts)  Store.workouts() rows -> GymCal entries.
 *
 * Everything from a friend (titles, dates, image URLs) is put in with DOM nodes + textContent, never HTML strings.
 * Needs: GymCal (calendar.js), GymPhoto (photo.js), Store, workoutEditor, show/buzz/toast/toastOk (index.html).
 */
(function () {
'use strict';
var ORDER_KEY = 'gymTlOrder';

function q(id) { return document.getElementById(id); }
function el(tag, cls, text, parent) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function niceDate(ds) { return new Date(ds + 'T12:00:00').toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'}); }

function styles() {
  if (q('profCss')) return;
  var s = document.createElement('style'); s.id = 'profCss';
  s.textContent = [
    '.mehead{display:flex;align-items:center;gap:14px;background:var(--card);border-radius:20px;padding:14px;margin-bottom:12px}',
    '.mehead .ini{width:56px;height:56px;border-radius:50%;background:var(--card2);color:var(--volt);font-weight:900;font-size:22px;display:flex;align-items:center;justify-content:center;flex:none}',
    '.mehead b{display:block;font-size:20px;overflow-wrap:anywhere}.mehead small{color:var(--dim);font-size:13px}',
    '.tlbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:2px 0 10px}',
    '.tlbar .pgseg{margin:0}',
    '.tladd{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}',
    '.tladd label.pick{height:42px;padding:0 14px;border-radius:12px;background:var(--volt);color:#0c0e12;font-weight:800;display:flex;align-items:center;cursor:pointer}',
    '.tladd label.pick input{display:none}.tladd input[type=date]{margin:0;height:42px;flex:1;min-width:130px}',
    '.tlday{color:var(--dim);font-size:12.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin:12px 2px 6px}',
    '.tlrow{display:flex;gap:10px;align-items:center;background:var(--card2);border-radius:14px;padding:8px;margin-bottom:6px}',
    '.tlimg{width:72px;height:96px;border-radius:10px;object-fit:cover;flex:none;background:#05070a;padding:0;border:0;cursor:zoom-in}',
    '.tlimg img{width:100%;height:100%;object-fit:cover;border-radius:10px;display:block}',
    '.tlinfo{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;align-items:flex-start}',
    '.tlbadge{font-size:11.5px;font-weight:800;border-radius:8px;padding:3px 7px;background:rgba(215,255,62,.14);color:var(--volt)}',
    '.tlbadge.prog{background:rgba(51,140,237,.16);color:#8cc2ff}',
    '.tlvis{display:flex;border-radius:10px;overflow:hidden;background:var(--bg2)}',
    '.tlvis button{height:32px;padding:0 10px;font-size:12.5px;font-weight:800;color:var(--dim)}',
    '.tlvis button.on{background:var(--volt);color:#0c0e12}.tlvis button.on.priv{background:var(--line);color:var(--text)}',
    '.tlvis button:disabled{opacity:.5}',
    '.tlstate{font-size:12px;color:var(--dim)}',
    '.tldel{color:var(--dim);font-size:12.5px;padding:4px 0}',
    '#lbox{position:fixed;inset:0;z-index:200;background:rgba(5,7,10,.96);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px}',
    '#lbox img{max-width:100%;max-height:82vh;border-radius:12px;object-fit:contain}',
    '#lbox p{color:var(--text);margin:12px 0 0;font-weight:700;text-align:center}#lbox button{position:absolute;top:14px;right:14px;width:44px;height:44px;border-radius:22px;background:var(--card2);color:var(--text);font-size:20px}',
    '.mesw{display:flex;align-items:center;gap:10px;font-size:15px;padding:4px 0}.mesw input{width:22px;height:22px;accent-color:#d7ff3e;flex:none}',
    '.mehint{color:var(--dim);font-size:13px;margin:6px 0 0}'
  ].join('\n');
  document.head.appendChild(s);
}

/* ---------- lightbox */
function enlarge(src, caption) {
  var old = q('lbox'); if (old) old.remove();
  var box = el('div', null, null, document.body); box.id = 'lbox';
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Photo');
  var img = el('img', null, null, box); img.src = src; img.alt = caption || 'Photo';
  if (caption) el('p', null, caption, box);
  var x = el('button', null, '✕', box); x.setAttribute('aria-label', 'Close');
  box.onclick = function () { box.remove(); };
}

/* ---------- photo timeline (own + friends') */
/* items: [{kind: 'progress'|'character', id, date, src, lv, pub}]
 * opts: {key, editable, joined, onShare(item, pub, btns), onDelete(item), emptyText} */
function timeline(box, items, opts) {
  opts = opts || {};
  styles();
  box.textContent = '';
  var order = lsGet(ORDER_KEY) === 'old' ? 'old' : 'new';
  var bar = el('div', 'tlbar', null, box);
  var seg = el('div', 'pgseg', null, bar); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Order');
  [['new', 'Newest first'], ['old', 'Oldest first']].forEach(function (o) {
    var b = el('button', o[0] === order ? 'on' : '', o[1], seg); b.setAttribute('data-order', o[0]);
    b.setAttribute('aria-pressed', o[0] === order ? 'true' : 'false');
    b.onclick = function () { if (window.buzz) buzz(); lsSet(ORDER_KEY, o[0]); timeline(box, items, opts); };
  });
  var list = (items || []).filter(function (p) { return p && p.src && /^\d{4}-\d{2}-\d{2}$/.test(p.date); }).slice();
  list.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  if (order === 'new') list.reverse();
  if (!list.length) { el('p', 'cempty', opts.emptyText || 'No photos yet.', box); return; }
  var day = null;
  list.forEach(function (p) {
    if (p.date !== day) { day = p.date; el('div', 'tlday', niceDate(day), box).setAttribute('data-tlday', day); }
    var row = el('div', 'tlrow', null, box);
    row.setAttribute('data-photo', p.id); row.setAttribute('data-kind', p.kind);
    var cap = (p.kind === 'character' ? 'Character' + (p.lv ? ' · LV ' + p.lv : '') : 'Progress photo') + ' · ' + niceDate(p.date);
    var th = el('button', 'tlimg', null, row); th.setAttribute('aria-label', 'Enlarge ' + cap);
    var im = el('img', null, null, th); im.src = p.src; im.alt = cap; im.loading = 'lazy';
    th.onclick = function () { if (window.buzz) buzz(); enlarge(p.src, cap); };
    var info = el('div', 'tlinfo', null, row);
    el('span', 'tlbadge' + (p.kind === 'character' ? '' : ' prog'), p.kind === 'character' ? '🧍 Character' + (p.lv ? ' · LV ' + p.lv : '') : '📸 Progress', info);
    if (opts.editable) {
      if (opts.joined) {
        var vis = el('div', 'tlvis', null, info); vis.setAttribute('role', 'group'); vis.setAttribute('aria-label', 'Who can see this photo');
        var bPriv = el('button', p.pub ? '' : 'on priv', '🔒 Private', vis), bPub = el('button', p.pub ? 'on' : '', '👥 Public', vis);
        bPriv.setAttribute('data-vis', 'private'); bPub.setAttribute('data-vis', 'public');
        bPriv.setAttribute('aria-pressed', p.pub ? 'false' : 'true'); bPub.setAttribute('aria-pressed', p.pub ? 'true' : 'false');
        var btns = [bPriv, bPub];
        bPriv.onclick = function () { if (p.pub && opts.onShare) opts.onShare(p, false, btns); };
        bPub.onclick = function () { if (!p.pub && opts.onShare) opts.onShare(p, true, btns); };
        el('span', 'tlstate', p.pub ? 'Friends can see this' : 'Only on this phone', info);
      } else el('span', 'tlstate', '🔒 Private · only on this phone', info);
      if (p.kind === 'progress' && opts.onDelete) {
        var del = el('button', 'tldel', 'Delete', info); del.setAttribute('data-del', p.id);
        del.onclick = function () { opts.onDelete(p); };
      }
    }
  });
}

/* ---------- calendar entries from Store.workouts() */
function calList(ws) {
  return (ws || []).map(function (w) {
    return {date: w.date_str, title: w.title, minutes: w.duration_min || 0, volume: w.total_volume_kg || 0, sets: w.total_sets || 0,
      id: w.id, editable: w.editable !== false, start: w.start};
  });
}

/* ---------- own profile screen */
function ensureScreen() {
  if (q('me')) return;
  var sec = document.createElement('section'); sec.className = 'screen'; sec.id = 'me';
  sec.innerHTML = '<div class="wrap"><div class="pghead"><button class="pgback" id="meBack" aria-label="Back">‹</button><h1>My profile</h1></div>' +
    '<div id="meHead"></div>' +
    '<div class="pgcard"><div class="pgch"><h3>Training calendar</h3></div><p class="pgsub">The days you trained. Tap a day to see it, or to log a workout you did then.</p><div id="meCal"></div></div>' +
    '<div class="pgcard"><div class="pgch"><h3>Progress photos</h3></div><p class="pgsub" id="mePhSub"></p>' +
    '<div class="tladd"><label class="pick">＋ Add photo<input type="file" accept="image/*" id="mePhIn"></label>' +
    '<input class="txt" type="date" id="mePhDate" aria-label="Photo date"></div><div id="mePh"></div></div>' +
    '<div class="pgcard" id="meShareCard"><div class="pgch"><h3>Sharing with friends</h3></div><div id="meShare"></div></div></div>';
  var home = q('home'); home.parentNode.insertBefore(sec, home.nextSibling);
  q('meBack').onclick = function () { if (window.buzz) buzz(); close(); };
  q('mePhDate').max = today(); q('mePhDate').value = today();
  q('mePhIn').onchange = function () {
    var f = this.files && this.files[0], input = this; if (!f) return;
    var d = q('mePhDate').value || today();
    if (d > today()) { toast('Pick a date that has happened'); input.value = ''; return; }
    GymPhoto.addProgress(f, d).then(function () { input.value = ''; toastOk('Photo added (private)'); drawPhotos(); })
      .catch(function () { input.value = ''; toast('Could not read that photo'); });
  };
}
function close() { window.show('home'); if (typeof window.render === 'function') window.render(); }
function open() {
  if (!window.Store) return;
  styles(); ensureScreen();
  if (window.Progress && Progress.styles) Progress.styles();
  window.show('me');
  drawHead(); drawCal(); drawPhotos(); drawShare();
}
function visible() { var s = q('me'); return !!(s && s.classList.contains('on')); }
function refresh() { if (visible()) { drawHead(); drawCal(); } }

function drawHead() {
  Promise.all([Store.get('socialMe'), Store.get('userName')]).then(function (v) {
    var name = String((v[0] && v[0].name) || v[1] || '').trim(), box = q('meHead'); box.textContent = '';
    var h = el('div', 'mehead', null, box);
    el('span', 'ini', (name || '?').split(/\s+/).map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase(), h);
    var t = el('div', null, null, h);
    el('b', null, name || 'You', t);
    var o = (window.prog && prog.overall) || null;
    el('small', null, o ? 'LV ' + o.lv + ' · ' + o.tier : 'Your training, photos and sharing', t);
  }).catch(function () {});
}
function drawCal() {
  var box = q('meCal'); if (!box || !Store.workouts) return;
  Store.workouts().then(function (ws) {
    GymCal.render(box, calList(ws), {key: 'own', editable: true,
      onAdd: function (date) { window.workoutEditor(null, {date: date}); },
      onOpen: function (id) { window.workoutEditor(id); }});
  }).catch(function () { box.innerHTML = '<p class="cempty">Could not load your workouts.</p>'; });
}
function drawPhotos() {
  var box = q('mePh'); if (!box || !window.GymPhoto) return;
  var joined = !!(window.Social && Social.joined());
  q('mePhSub').textContent = joined
    ? 'New photos are Private (only on this phone). Mark one Public and only your friends can see it; switch it back and it is deleted from the friends server.'
    : 'Photos stay on this phone. Join Friends (home screen) if you want to share some of them with friends.';
  GymPhoto.timeline().then(function (list) {
    timeline(box, list.map(function (p) { return {kind: p.kind, id: p.id, date: p.date, src: p.img, lv: p.lv, pub: p.pub}; }), {
      key: 'own', editable: true, joined: joined,
      emptyText: 'No photos yet. Add a progress photo above; character photos (Settings → Character) show up here too.',
      onShare: function (p, pub, btns) {
        btns.forEach(function (b) { b.disabled = true; });
        Social.setPhotoPublic(p.kind, p.id, pub).then(function () {
          toastOk(pub ? 'Public: your friends can see this photo' : 'Private: removed from the friends server'); drawPhotos();
        }).catch(function (err) { btns.forEach(function (b) { b.disabled = false; }); toast(err.message || 'Could not change it'); });
      },
      onDelete: function (p) {
        if (!confirm('Delete this photo from this phone' + (p.pub ? ' and from your friends’ view' : '') + '?')) return;
        (p.pub ? Social.setPhotoPublic(p.kind, p.id, false) : Promise.resolve()).then(function () { return GymPhoto.removeProgress(p.id); })
          .then(function () { toastOk('Photo deleted'); drawPhotos(); }).catch(function (err) { toast(err.message || 'Could not delete'); });
      }});
  }).catch(function () { box.innerHTML = '<p class="cempty">Photos unavailable.</p>'; });
}
function drawShare() {
  var box = q('meShare'); if (!box) return; box.textContent = '';
  var card = q('meShareCard');
  if (!(window.Social && Social.enabled())) { card.style.display = 'none'; return; }
  card.style.display = '';
  if (!Social.joined()) { el('p', 'mehint', 'You haven’t joined Friends, so nothing leaves this phone.', box); return; }
  var lab = el('label', 'mesw', null, box), cb = el('input', null, null, lab); cb.type = 'checkbox'; cb.id = 'meShareStats';
  el('span', null, 'Share my stats (calendar, Progress, recent workouts)', lab);
  cb.checked = Social.sharing();
  var hint = el('p', 'mehint', null, box);
  function say() { hint.textContent = cb.checked ? 'Friends see your calendar, Progress cards and recent workouts.' : 'Friends see only your name and level.'; }
  say();
  cb.onchange = function () {
    cb.disabled = true;
    Social.setSharing(cb.checked).then(function () { cb.disabled = false; say(); toastOk(cb.checked ? 'Sharing your stats' : 'Stats hidden: friends see name + level'); })
      .catch(function (err) { cb.disabled = false; cb.checked = !cb.checked; say(); toast(err.message); });
  };
  el('p', 'mehint', 'Photos are shared one by one (Public / Private above), whatever this switch says.', box);
}

window.GymProfile = {open: open, close: close, refresh: refresh, timeline: timeline, calList: calList, enlarge: enlarge,
  refreshPhotos: function () { if (visible()) drawPhotos(); }};
})();
