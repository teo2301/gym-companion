/* Gym Companion social: profiles, friends and a friends-only feed of workout posts with photos.
 * Talks to the gym-social API at window.GYM_SOCIAL_API (set in config.js; no API = feature hidden).
 * The login is a secret token kept via Store (so it is in backups and survives a phone change).
 * Uses the page's helpers (openSheet, closeSheet, esc, toast, toastOk, buzz, Store, prog, live, fmtW).
 */
(function () {
'use strict';
var BASE = String(window.GYM_SOCIAL_API || '').replace(/\/+$/, '');
var ORIGIN = BASE.replace(/^(https?:\/\/[^\/]+).*$/, '$1');
var INVITE_URL = 'https://teo2301.github.io/gym-companion/#friend=';
var token = null, me = null, pendingInvite = null, feedCache = [], shareOn = true, lastSync = 0, lastSig = '', owner = null, lastOwnSig = '', lastOwnAt = 0, lastPhotoAt = 0;
var SNAP_MAX = 900 * 1024;            // the server takes up to 1 MB; trim history before that

function $(id) { return document.getElementById(id); }
function e(t) { return window.esc ? window.esc(t) : String(t).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }
function enabled() { return !!BASE; }
function media(p) { return p ? ORIGIN + p : ''; }

/* ---------- API */
function api(method, path, body, blob) {
  var h = {};
  if (token) h.Authorization = 'Bearer ' + token;
  var opt = {method: method, headers: h};
  if (blob) { h['Content-Type'] = 'image/jpeg'; opt.body = blob; }
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  return fetch(BASE + path, opt).then(function (r) {
    return r.json().catch(function () { return {ok: false, error: 'HTTP ' + r.status}; }).then(function (j) {
      if (!r.ok || j.ok === false) {
        var err = new Error(j.error || ('HTTP ' + r.status)); err.status = r.status;
        if (r.status === 401 && token) forget();
        throw err;
      }
      return j;
    });
  }, function () { throw new Error('No connection to the friends server'); });
}
function remember(t, m) {
  if (t) { token = t; Store.set('socialToken', t); }
  if (m) {
    me = m; Store.set('socialMe', m);
    if (m.name) Store.set('userName', m.name);      // the header says "Hi <your Friends name>"
    if (window.updateHello) setTimeout(window.updateHello, 0);
  }
}
function forget() { token = null; me = null; Store.set('socialToken', null); Store.set('socialMe', null); renderHome(); }

/* ---------- images: resize on the phone (the server re-encodes again and strips all metadata) */
function resize(file, max, square) {
  function draw(src, w, h) {
    var sx = 0, sy = 0, sw = w, sh = h;
    if (square) { var s = Math.min(w, h); sx = (w - s) / 2; sy = (h - s) / 2; sw = sh = s; }
    var k = Math.min(1, max / Math.max(sw, sh)), c = document.createElement('canvas');
    c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    c.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(new Error('could not read photo')); }, 'image/jpeg', 0.86); });
  }
  if (window.createImageBitmap) {
    return createImageBitmap(file, {imageOrientation: 'from-image'}).then(function (bm) { return draw(bm, bm.width, bm.height); })
      .catch(function () { return viaImg(); });
  }
  return viaImg();
  function viaImg() {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () { URL.revokeObjectURL(u); draw(im, im.naturalWidth, im.naturalHeight).then(res, rej); };
      im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('That photo type isn’t supported')); };
      im.src = u;
    });
  }
}

/* ---------- small renderers */
function avatar(u, cls) {
  if (u && u.avatar) return '<img class="sav ' + (cls || '') + '" src="' + e(media(u.avatar)) + '" alt="" loading="lazy">';
  var ini = String((u && u.name) || '?').split(/\s+/).map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase();
  return '<span class="sav ini ' + (cls || '') + '">' + e(ini) + '</span>';
}
function ago(ms) {
  var s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 7 * 86400) return Math.floor(s / 86400) + 'd';
  return new Date(ms).toLocaleDateString('en-GB', {day: 'numeric', month: 'short'});
}
function kg(w) { return (Math.round(w * 100) / 100).toString(); }
function workoutCard(w) {
  if (!w) return '';
  var bits = [w.minutes ? w.minutes + ' min' : '', w.sets ? w.sets + ' sets' : '', w.volume ? w.volume.toLocaleString() + ' kg' : ''].filter(Boolean);
  return '<div class="swk"><div class="swkh"><b>' + e(w.title) + '</b>' + (w.lv ? '<span class="slv">LV ' + w.lv + '</span>' : '') + '</div>' +
    (bits.length ? '<div class="swks">' + e(bits.join(' · ')) + '</div>' : '') +
    (w.lifts || []).map(function (l) { return '<div class="swkl"><span>' + e(l.name) + '</span><b class="num">' + (l.w ? kg(l.w) + ' kg × ' : '') + l.r + (l.sets > 1 ? ' · ' + l.sets + ' sets' : '') + '</b></div>'; }).join('') +
    ((w.prs || []).length ? '<div class="sprs">' + w.prs.map(function (p) { return '<span>🏆 ' + e(p) + '</span>'; }).join('') + '</div>' : '') + '</div>';
}
function postHtml(p) {
  return '<div class="spost" data-id="' + e(p.id) + '">' +
    '<div class="sph" data-a="prof" data-u="' + e(p.author.id) + '">' + avatar(p.author) + '<div class="spn"><b>' + e(p.author.name) + '</b><small>' + e(ago(p.created)) + '</small></div>' +
    (p.mine ? '<button class="sdel" data-a="del" aria-label="Delete post">⋯</button>' : '') + '</div>' +
    (p.caption ? '<p class="scap">' + e(p.caption).replace(/\n/g, '<br>') + '</p>' : '') +
    (p.photo ? '<img class="sphoto" src="' + e(media(p.photo)) + '" alt="Progress photo" loading="lazy">' : '') +
    workoutCard(p.workout) +
    '<div class="sact"><button data-a="like" class="' + (p.liked ? 'on' : '') + '">' + (p.liked ? '♥' : '♡') + ' <span>' + p.likes + '</span></button>' +
    '<button data-a="com">💬 <span>' + p.comments + '</span></button></div>' +
    '<div class="scom" hidden></div></div>';
}

/* ---------- styles (kept here so the feature is one file) */
function styles() {
  if ($('socialCss')) return;
  var s = document.createElement('style'); s.id = 'socialCss';
  s.textContent = [
    '.sav{width:40px;height:40px;border-radius:50%;object-fit:cover;flex:none;background:var(--card2)}',
    '.sav.ini{display:flex;align-items:center;justify-content:center;font-weight:800;color:var(--volt);font-size:15px}',
    '.sav.big{width:84px;height:84px;font-size:28px}.sav.sm{width:28px;height:28px;font-size:11px}',
    '.shome{background:var(--card);border-radius:20px;padding:16px;margin-bottom:10px}',
    '.shome p{color:var(--dim);margin:4px 0 12px;font-size:14.5px}',
    '.sbtns{display:flex;gap:8px;flex-wrap:wrap}.sbtns button{flex:1;min-width:96px;height:44px;border-radius:14px;background:var(--card2);color:var(--text);font-weight:700;font-size:14.5px}',
    '.sbtns button.pri{background:var(--volt);color:#0c0e12}',
    '.smini{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}.smini:last-of-type{border:0}',
    '.smini div{flex:1;min-width:0}.smini b{display:block;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.smini small{color:var(--dim);font-size:12.5px}',
    '.smini img.th{width:44px;height:44px;border-radius:10px;object-fit:cover;flex:none}',
    '.spost{background:var(--card);border-radius:20px;padding:14px;margin-bottom:12px}',
    '.sph{display:flex;align-items:center;gap:10px}.spn{flex:1;min-width:0}.spn b{display:block;font-size:15.5px}.spn small{color:var(--dim);font-size:12.5px}',
    '.sdel{width:36px;height:36px;border-radius:10px;color:var(--dim);font-size:20px}',
    '.scap{margin:10px 2px 0;font-size:15.5px;line-height:1.45;overflow-wrap:anywhere}',
    '.sphoto{display:block;width:100%;max-height:560px;object-fit:cover;border-radius:14px;margin-top:10px;background:var(--card2)}',
    '.swk{background:var(--card2);border-radius:14px;padding:12px;margin-top:10px}',
    '.swkh{display:flex;align-items:center;justify-content:space-between;gap:8px}.swkh b{font-size:16px}',
    '.slv{font-size:12px;font-weight:800;color:#0c0e12;background:var(--volt);border-radius:8px;padding:3px 7px}',
    '.swks{color:var(--dim);font-size:13px;margin:2px 0 6px}',
    '.swkl{display:flex;justify-content:space-between;gap:10px;font-size:13.5px;padding:3px 0}.swkl span{color:var(--dim);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.sprs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.sprs span{font-size:12.5px;background:rgba(255,176,32,.14);color:var(--pr);border-radius:8px;padding:4px 8px}',
    '.sact{display:flex;gap:6px;margin-top:10px}.sact button{height:38px;padding:0 14px;border-radius:12px;background:var(--card2);color:var(--text);font-weight:700;font-size:15px}',
    '.sact button.on{color:var(--hr)}',
    '.scom{margin-top:10px}.scrow{display:flex;gap:8px;align-items:flex-start;margin-bottom:8px}.scrow div{flex:1;min-width:0;background:var(--card2);border-radius:12px;padding:7px 10px;font-size:14px;overflow-wrap:anywhere}',
    '.scrow div b{display:block;font-size:12.5px;color:var(--dim)}.scrow button{color:var(--dim2);font-size:13px;padding:6px}',
    '.scin{display:flex;gap:8px}.scin input{flex:1;margin:0;height:42px}.scin button{flex:none;height:42px;padding:0 14px;border-radius:12px;background:var(--volt);color:#0c0e12;font-weight:700}',
    '.scode{font:800 26px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;color:var(--volt);text-align:center;background:var(--card);border-radius:16px;padding:16px;margin:6px 0 10px}',
    '.sfr{display:flex;align-items:center;gap:10px;background:var(--card);border-radius:14px;padding:8px 10px;margin-bottom:6px}.sfr b{flex:1}.sfr button{color:var(--dim);font-size:13.5px;padding:8px}',
    '.spick{display:flex;align-items:center;gap:12px;margin:4px 0 12px}.spick label{height:44px;padding:0 16px;border-radius:14px;background:var(--card2);display:flex;align-items:center;font-weight:700;color:var(--volt)}',
    '.spick input{display:none}.sprev{width:84px;height:84px;border-radius:14px;object-fit:cover}',
    '.sdash{flex:1;min-width:96px;height:44px;border-radius:14px;background:var(--card2);color:var(--text);font-weight:700;font-size:14.5px;display:flex;align-items:center;justify-content:center;text-decoration:none}',
    '.sfn{cursor:pointer}.sfn small{color:var(--dim);font-weight:600;font-size:12.5px;margin-left:4px}',
    '.sph[data-a=prof]{cursor:pointer}',
    '.pvh{display:flex;align-items:center;gap:14px;margin-bottom:14px}',
    '.pvlv{display:flex;gap:14px;align-items:center;background:var(--card);border-radius:20px;padding:14px}',
    '.pvfig{width:38%;max-width:150px;flex:none}.pvfig svg{width:100%;height:auto;display:block}',
    '.pvlvt{flex:1;min-width:0}.pvlvt small{display:block;color:var(--dim);font-size:12.5px}',
    '.pvnum{display:block;font-size:56px;line-height:1;font-weight:900;color:var(--text)}',
    '.pvbar{height:8px;border-radius:6px;background:var(--card2);margin-top:10px;overflow:hidden}.pvbar i,.pvm i{display:block;height:100%;border-radius:6px}',
    '.pvstats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px}.pvstats div{background:var(--card);border-radius:14px;padding:10px 4px;text-align:center}',
    '.pvstats b{display:block;font-size:18px}.pvstats small{color:var(--dim);font-size:11.5px}',
    '.pvm{display:flex;align-items:center;gap:10px;margin-bottom:6px;font-size:13.5px}.pvm span{width:84px;flex:none;color:var(--dim)}',
    '.pvm div{flex:1;height:8px;border-radius:6px;background:var(--card2);overflow:hidden}.pvm small{width:78px;flex:none;text-align:right;color:var(--dim);font-size:12px}',
    '.pvwd{color:var(--dim);font-size:12.5px;margin:10px 4px -4px}',
    '.stog{display:flex;align-items:center;gap:10px;background:var(--card);border-radius:14px;padding:12px;margin-bottom:10px;font-size:15px}.stog input{width:22px;height:22px;accent-color:var(--volt)}'
  ].join('\n');
  document.head.appendChild(s);
}

/* ---------- home card */
function renderHome() {
  var box = $('socialBox'), sec = $('socialSec');
  if (!box || !sec) return;
  sec.style.display = enabled() ? '' : 'none';
  if (!enabled()) return;
  if (!token) {
    box.innerHTML = '<div class="shome"><b style="font-size:17px">Train with your friends</b><p>Share your workouts and progress photos with friends and family, and see theirs. Only people you add can see your posts.</p>' +
      '<div class="sbtns"><button class="pri" id="sJoin">Join</button></div></div>';
    $('sJoin').onclick = function () { buzz(); joinSheet(); };
    return;
  }
  box.innerHTML = '<div class="shome"><div id="sMini"><p>Loading…</p></div><div class="sbtns" style="margin-top:10px">' +
    '<button class="pri" id="sOpen">Open feed</button><button id="sFriends">👥 Friends</button>' +
    (owner && owner.dashboard_url ? '<a class="sdash" href="' + e(owner.dashboard_url) + '" target="_blank" rel="noopener">📊 Dashboard</a>' : '') + '</div></div>';
  $('sOpen').onclick = function () { buzz(); feedSheet(); };
  $('sFriends').onclick = function () { buzz(); friendsSheet(); };
  api('GET', '/api/feed').then(function (j) {
    feedCache = j.posts;
    if (!$('sMini')) return;
    $('sMini').innerHTML = j.posts.length ? j.posts.slice(0, 3).map(function (p) {
      return '<div class="smini">' + avatar(p.author, 'sm') + '<div><b>' + e(p.author.name) + ' · ' + e(p.workout ? p.workout.title : (p.caption || 'Post')) + '</b><small>' +
        e(ago(p.created)) + ' · ♥ ' + p.likes + ' · 💬 ' + p.comments + '</small></div>' + (p.photo ? '<img class="th" src="' + e(media(p.photo)) + '" alt="">' : '') + '</div>';
    }).join('') : '<p>No posts yet. Add friends, then share a workout from the finish screen.</p>';
  }).catch(function (err) { if ($('sMini')) $('sMini').innerHTML = '<p>' + e(err.message) + '</p>'; });
}

/* ---------- join / profile */
function photoPicker(id, label) {
  return '<div class="spick"><label>' + label + '<input type="file" accept="image/*" id="' + id + '"></label><span id="' + id + 'Prev"></span></div>';
}
function wirePicker(id, square, onBlob) {
  $(id).onchange = function () {
    var f = this.files && this.files[0]; if (!f) return;
    resize(f, square ? 512 : 1600, square).then(function (b) {
      onBlob(b);
      var u = URL.createObjectURL(b);
      $(id + 'Prev').innerHTML = '<img class="sprev" src="' + u + '" alt="">';
    }).catch(function (err) { toast(err.message); });
  };
}
function joinSheet() {
  var blob = null;
  openSheet('<h2 style="margin:0 0 4px;font-size:24px">Join your friends</h2>' +
    '<p class="sub" style="margin-bottom:12px">Pick the name friends will see. Your workouts stay private until you choose to share one.</p>' +
    '<input class="txt" id="sName" maxlength="30" placeholder="Your name" autocomplete="nickname">' +
    photoPicker('sAva', '📷 Profile photo (optional)') +
    '<button class="log" id="sGo">Join</button>' +
    '<button class="finish" id="sHave">I already have an account (recovery key)</button>');
  $('sHave').onclick = function () { recoverSheet(); };
  Store.get('userName').then(function (n) { if (n && $('sName') && !$('sName').value) $('sName').value = n; }).catch(function () {});
  wirePicker('sAva', true, function (b) { blob = b; });
  $('sGo').onclick = function () {
    var name = $('sName').value.trim(); if (!name) { toast('Pick a name'); return; }
    this.disabled = true;
    api('POST', '/api/register', {name: name}).then(function (j) {
      remember(j.token, j.me);
      return blob ? api('PUT', '/api/me/avatar', undefined, blob).then(function (k) { remember(null, k.me); }) : null;
    }).then(function () {
      closeSheet(); toastOk('Welcome, ' + me.name); renderHome();
      if (pendingInvite) setTimeout(acceptInvite, 300); else setTimeout(recoveryKeySheet, 300);
    }).catch(function (err) { toast(err.message); $('sGo').disabled = false; });
  };
}
function profileSheet() {
  var blob = null;
  openSheet('<h2 style="margin:0 0 12px;font-size:24px">Your profile</h2>' +
    '<div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">' + avatar(me, 'big') + '<div style="flex:1">' + photoPicker('sAva2', 'Change photo') + '</div></div>' +
    '<input class="txt" id="sName2" maxlength="30" value="' + e(me.name) + '">' +
    (owner && window.GYM_PUBLIC ? '<label class="stog"><input type="checkbox" id="sUseSrv"' + (Store.remote ? ' checked' : '') + '><span>Use my server (watch live link, dashboards)</span></label>' : '') +
    '<label class="stog"><input type="checkbox" id="sShareProf"' + (shareOn ? ' checked' : '') + '><span>Share my stats (calendar, Progress, recent workouts). Off = friends see only your name and level.</span></label>' +
    '<p class="sub" style="font-size:12.5px;margin:-4px 2px 10px">Photos are shared one at a time: My profile → Progress photos → Public / Private.</p>' +
    '<button class="log" id="sSaveP">Save</button>' +
    '<button class="finish" id="sRecov">🔑 Recovery key (keeps your friends if you lose your login)</button>' +
    '<button class="finish" id="sReset">Get a new friend code</button>' +
    '<button class="danger" id="sDelAcc">Delete my account and all my posts</button>');
  wirePicker('sAva2', true, function (b) { blob = b; });
  $('sSaveP').onclick = function () {
    var name = $('sName2').value.trim();
    var jobs = [];
    var srv = $('sUseSrv'), srvChange = srv && srv.checked !== !!Store.remote;
    if (srvChange) { try { if (srv.checked) localStorage.removeItem('gymRemoteOff'); else localStorage.setItem('gymRemoteOff', '1'); localStorage.setItem('gymRemoteTok', token); } catch (err) {} }
    var want = $('sShareProf').checked;
    if (want !== shareOn) jobs.push(setSharing(want));
    if (name && name !== me.name) jobs.push(api('POST', '/api/me', {name: name}).then(function (j) { remember(null, j.me); }));
    if (blob) jobs.push(api('PUT', '/api/me/avatar', undefined, blob).then(function (j) { remember(null, j.me); }));
    Promise.all(jobs).then(function () { if (srvChange) { location.reload(); return; } closeSheet(); toastOk('Profile saved'); renderHome(); }).catch(function (err) { toast(err.message); });
  };
  $('sRecov').onclick = function () { recoveryKeySheet(); };
  $('sReset').onclick = function () {
    if (!confirm('Make a new friend code? Your old code and invite links stop working (current friends stay).')) return;
    api('POST', '/api/me/code').then(function (j) { remember(null, j.me); toastOk('New code: ' + j.me.code); friendsSheet(); }).catch(function (err) { toast(err.message); });
  };
  $('sDelAcc').onclick = function () {
    if (!confirm('Delete your friends account? All your posts, photos, likes and comments are removed for good. Your workouts in this app are NOT affected.')) return;
    api('DELETE', '/api/me').then(function () { closeSheet(); forget(); toastOk('Account deleted'); }).catch(function (err) { toast(err.message); });
  };
}

/* ---------- recovery: a lost login must never mean lost friends */
function recoveryKeySheet() {
  openSheet('<h2 style="margin:0 0 4px;font-size:24px">Your recovery key</h2>' +
    '<p class="sub" style="margin-bottom:10px">Save this somewhere safe (notes app, password manager). If you ever lose your login — new phone, cleared data — enter it on the Join screen and you get your friends, posts and profile back. Making a new key replaces the old one.</p>' +
    '<div class="scode" id="sKey" style="font-size:19px">…</div>' +
    '<div class="sbtns"><button class="pri" id="sKeyCopy">Copy key</button><button id="sKeyDone">Done</button></div>');
  $('sKeyDone').onclick = function () { closeSheet(); setTimeout(friendsSheet, 250); };
  api('POST', '/api/me/recovery').then(function (j) {
    $('sKey').textContent = j.key; $('sKeyCopy').onclick = function () { copy(j.key); };
  }).catch(function (err) { toast(err.message); });
}
function recoverSheet() {
  openSheet('<h2 style="margin:0 0 4px;font-size:24px">Get your account back</h2>' +
    '<p class="sub" style="margin-bottom:12px">Enter the recovery key you saved (Friends → Profile → Recovery key).</p>' +
    '<input class="txt" id="sRk" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autocomplete="off" autocapitalize="characters">' +
    '<button class="log" id="sRkGo">Sign in</button>');
  $('sRkGo').onclick = function () {
    var btn = this; btn.disabled = true;
    api('POST', '/api/recover', {key: $('sRk').value}).then(function (j) {
      remember(j.token, j.me); closeSheet(); toastOk('Welcome back, ' + j.me.name); renderHome(); setTimeout(friendsSheet, 300);
      setTimeout(function () { sync(true); }, 800);
    }).catch(function (err) { toast(err.message); btn.disabled = false; });
  };
}

/* ---------- friends */
function friendsSheet() {
  var link = INVITE_URL + encodeURIComponent(me.code);
  openSheet('<h2 style="margin:0 0 4px;font-size:24px">Friends</h2><p class="sub" style="margin-bottom:6px">Your friend code</p>' +
    '<div class="scode">' + e(me.code) + '</div>' +
    '<div class="sbtns" style="margin-bottom:16px"><button class="pri" id="sInvite">Share invite</button><button id="sCopy">Copy code</button><button id="sProf">👤 Profile</button></div>' +
    '<div class="scin" style="margin-bottom:16px"><input class="txt" id="sAdd" placeholder="Friend’s code (e.g. K7Q2-M9XP)" autocomplete="off" autocapitalize="characters"><button id="sAddGo">Add</button></div>' +
    '<div class="label" style="margin:0 2px 8px">Your friends</div><div id="sList"><p class="sub">Loading…</p></div>');
  $('sInvite').onclick = function () {
    var txt = 'Add me on Gym Companion: ' + link;
    if (navigator.share) navigator.share({title: 'Gym Companion', text: 'Add me on Gym Companion (code ' + me.code + ')', url: link}).catch(function () {});
    else copy(txt);
  };
  $('sCopy').onclick = function () { copy(me.code); };
  $('sProf').onclick = function () { profileSheet(); };
  $('sAddGo').onclick = function () { addFriend($('sAdd').value); };
  loadFriends();
}
function loadFriends() {
  api('GET', '/api/friends').then(function (j) {
    if (!$('sList')) return;
    $('sList').innerHTML = j.friends.length ? j.friends.map(function (f) {
      return '<div class="sfr">' + avatar(f) + '<b class="sfn" data-u="' + e(f.id) + '">' + e(f.name) + ' <small>View ›</small></b><button data-id="' + e(f.id) + '" data-n="' + e(f.name) + '">Remove</button></div>';
    }).join('') : '<p class="sub">No friends yet. Share your invite, or type a friend’s code above.</p>';
    Array.prototype.forEach.call($('sList').querySelectorAll('[data-u]'), function (b) {
      b.onclick = function () { buzz(); profileView(b.getAttribute('data-u')); };
    });
    Array.prototype.forEach.call($('sList').querySelectorAll('button[data-id]'), function (b) {
      b.onclick = function () {
        if (!confirm('Remove ' + b.getAttribute('data-n') + '? You stop seeing each other’s posts.')) return;
        api('DELETE', '/api/friends/' + b.getAttribute('data-id')).then(function () { loadFriends(); renderHome(); }).catch(function (err) { toast(err.message); });
      };
    });
  }).catch(function (err) { if ($('sList')) $('sList').innerHTML = '<p class="sub">' + e(err.message) + '</p>'; });
}
function addFriend(code) {
  code = String(code || '').trim(); if (!code) { toast('Type a friend code'); return; }
  return api('POST', '/api/friends', {code: code}).then(function (j) {
    buzz([10, 40, 10]); toastOk('You and ' + j.friend.name + ' are now friends'); if ($('sAdd')) $('sAdd').value = '';
    loadFriends(); renderHome();
  }).catch(function (err) { toast(err.message); });
}
function copy(t) {
  (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toastOk('Copied'); }, function () { prompt('Copy this:', t); });
}
function acceptInvite() {
  var code = pendingInvite; pendingInvite = null;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (err) {}
  if (!code || !me || code === me.code) return;
  if (confirm('Add the person who invited you (code ' + code + ') as a friend?')) addFriend(code);
}

/* ---------- profile snapshot: what friends see on my profile page */
function cardFor(w, summary) {
  var lifts = w.exercises.map(function (x) {
    var work = x.sets.filter(function (s) { return s.type !== 'warmup' && s.type !== 'cardio'; }); if (!work.length) return null;
    var top = work.reduce(function (a, b) { return b.w > a.w || (b.w === a.w && b.r > a.r) ? b : a; });
    return {name: x.name, w: top.w, r: top.r, sets: work.length, vol: work.reduce(function (t, s) { return t + s.w * s.r; }, 0)};
  }).filter(Boolean).sort(function (a, b) { return b.vol - a.vol; }).slice(0, 4);
  var o = (window.prog && prog.overall) || {};
  return {title: w.title, date: w.date_str, minutes: (summary && summary.minutes) || w.duration_min, sets: (summary && summary.sets) || w.total_sets,
    volume: (summary && summary.volume) || w.total_volume_kg, lv: o.lv || 0, tier: o.tier || '',
    lifts: lifts.map(function (l) { return {name: l.name, w: l.w, r: l.r, sets: l.sets}; }),
    prs: ((summary && summary.prs) || []).map(function (p) { return p.ex + ' ' + kg(p.w) + ' kg × ' + p.r; })};
}
function buildSnapshot() {
  var o = (window.prog && prog.overall) || null; if (!o || !Store.workouts) return Promise.resolve(null);
  var base = {lv: o.lv, tier: o.tier, score: o.score, xp: ((o.score * 10) % 1)};
  if (!shareOn) { base.shared = false; return Promise.resolve(base); }     // "Share my stats" off: name + level only
  return Promise.all([Store.workouts(), Store.stats ? Store.stats().catch(function () { return null; }) : null]).then(function (v) {
    var list = v[0], st = v[1], P = window.prog || {};
    var total = list.reduce(function (t, w) { return t + (w.total_volume_kg || 0); }, 0);
    var weeks = {}, wk = function (ms) { return Math.floor((ms - 3 * 86400000) / (7 * 86400000)); };   // Monday-based weeks
    list.forEach(function (w) { weeks[wk(w.start)] = 1; });
    var cur = wk(Date.now()), streak = 0, k = weeks[cur] ? cur : cur - 1;
    while (weeks[k]) { streak++; k--; }
    var recent = list.filter(function (w) { return w.start > Date.now() - 84 * 86400000; }).length;
    var oldest = list.length ? list[list.length - 1].date_str : '';
    return Promise.all(list.slice(0, 12).map(function (w) { return Store.workout(w.id).then(function (f) { return cardFor(f); }).catch(function () { return null; }); }))
      .then(function (cards) {
        var mn = window.mname || function (x) { return x; };
        var snap = {lv: o.lv, tier: o.tier, score: o.score, xp: ((o.score * 10) % 1), shared: true,
          muscles: Object.keys(P.muscles || {}).map(function (m) { var x = P.muscles[m]; return {name: mn(m), level: x.level, score: x.score, lift: x.lift || ''}; })
            .sort(function (a, b) { return b.score - a.score; }),
          stats: {workouts: list.length, volume: Math.round(total), streak_weeks: streak, avg_week: Math.round(recent / 12 * 10) / 10, since: oldest},
          workouts: cards.filter(Boolean),
          // calendar: every workout, newest first, compact (date, title, minutes, kg, sets) - nothing else
          days: list.map(function (w) { return {d: w.date_str, t: w.title, m: w.duration_min || 0, v: w.total_volume_kg || 0, s: w.total_sets || 0}; }),
          week: window.plan && plan.week ? plan.week : null,
          progress: st ? {stats: {workouts: st.workouts || [], exercises: (st.exercises || []).slice(0, 200), prs: (st.prs || []).slice(-500)},
            prog: {overall: P.overall || null, strongest: P.strongest || null, weakest: P.weakest || null,
              weeks: (P.weeks || []).map(function (w) { return {week: w.week, lv: w.lv, score: w.score, sets: w.sets || {}, groups: w.groups || {}}; }),
              muscles: P.muscles || {}}} : null};
        return fit(snap);
      });
  });
}
/* keep the snapshot under the server's cap: drop the oldest history first */
function fit(snap) {
  var cuts = [function () { snap.progress && (snap.progress.prog.weeks = snap.progress.prog.weeks.slice(-260)); },
    function () { snap.days = snap.days.slice(0, 1500); },
    function () { snap.progress && (snap.progress.stats.workouts = snap.progress.stats.workouts.slice(-1000)); },
    function () { snap.progress && (snap.progress.prog.weeks = snap.progress.prog.weeks.slice(-104)); },
    function () { snap.days = snap.days.slice(0, 600); snap.progress && (snap.progress.stats.workouts = snap.progress.stats.workouts.slice(-400)); }];
  for (var i = 0; JSON.stringify(snap).length > SNAP_MAX && i < cuts.length; i++) cuts[i]();
  return snap;
}
function pushProfile() {
  return buildSnapshot().then(function (snap) {
    if (!snap) return;
    var sig = JSON.stringify(snap);
    return api('PUT', '/api/me/profile', snap).then(function () { lastSync = Date.now(); lastSig = sig; });
  });
}
/* "Share my stats" master switch (default on). Off = friends see only name + level; photos stay per photo. */
function setSharing(on) {
  shareOn = !!on;
  return Store.set('socialShare', shareOn).then(function () { return token ? pushProfile() : null; });
}
/* push my snapshot (throttled; skipped if nothing changed) */
function sync(force) {
  if (token && enabled()) { ownerSync(force); syncPhotos(force); }
  if (!token || !enabled()) return Promise.resolve();
  if (!force && Date.now() - lastSync < 5 * 60 * 1000) return Promise.resolve();
  return buildSnapshot().then(function (snap) {
    if (!snap) return;
    var sig = JSON.stringify(snap);
    if (!force && sig === lastSig) { lastSync = Date.now(); return; }
    return api('PUT', '/api/me/profile', snap).then(function () { lastSync = Date.now(); lastSig = sig; });
  }).catch(function () {});
}

/* ---------- photos: Public (friends only) or Private (this phone only), one photo at a time */
function findPhoto(kind, id) {
  return GymPhoto.timeline().then(function (l) { return l.filter(function (p) { return p.kind === kind && p.id === id; })[0] || null; });
}
function upload(p) {
  var lv = p.kind === 'character' ? (p.lv || 0) : ((window.prog && prog.overall && prog.overall.lv) || 0);
  return api('PUT', '/api/me/photos?kind=' + p.kind + '&date=' + encodeURIComponent(p.date) + '&lv=' + lv, undefined, GymPhoto.blobOf(p.img))
    .then(function (j) { return GymPhoto.setShare(p.kind, p.id, true, j.photo.id); });
}
function setPhotoPublic(kind, id, pub) {
  if (!token || !window.GymPhoto) return Promise.reject(new Error('Join Friends first'));
  return findPhoto(kind, id).then(function (p) {
    if (!p) throw new Error('Photo not found');
    if (pub) return p.pub && p.rid ? p : upload(p);
    var del = p.rid ? api('DELETE', '/api/me/photos/' + p.rid) : Promise.resolve();
    return del.then(function () { return GymPhoto.setShare(kind, id, false); });
  });
}
/* make the server match the phone: upload public photos it lacks, drop ones the phone no longer has / made private */
function syncPhotos(force) {
  if (!window.GymPhoto || (!force && Date.now() - lastPhotoAt < 10 * 60 * 1000)) return Promise.resolve();
  lastPhotoAt = Date.now();
  return Promise.all([GymPhoto.timeline(), api('GET', '/api/me/photos')]).then(function (v) {
    var have = {}; v[1].photos.forEach(function (x) { have[x.id] = 1; });
    var pub = v[0].filter(function (p) { return p.pub; }), chain = Promise.resolve();
    pub.forEach(function (p) { if (!p.rid || !have[p.rid]) chain = chain.then(function () { return upload(p); }); });
    return chain.then(function () { return GymPhoto.timeline(); }).then(function (l) {
      return api('POST', '/api/me/photos/keep', {ids: l.filter(function (p) { return p.pub && p.rid; }).map(function (p) { return p.rid; })});
    });
  }).catch(function () {});
}

/* owner only: after signing in once, the public app talks to the owner's own server (watch live link, all
 * history and dashboards' data) via the friends API; GymStore falls back to this device if it can't reach it. */
function linkOwner() {
  if (!window.GYM_PUBLIC || !token || Store.remote) return;
  try {
    if (localStorage.getItem('gymRemoteOff')) return;
    if (localStorage.getItem('gymRemoteTok') !== token) { localStorage.setItem('gymRemoteTok', token); location.reload(); }
  } catch (err) {}
}
/* owner only (public app): upload every workout so the server's watch, dashboards and reports see them */
function ownerSync(force) {
  if (!owner || !window.GYM_PUBLIC || Store.mode !== 'public' || !Store.backupData) return Promise.resolve();
  if (!force && Date.now() - lastOwnAt < 60 * 1000) return Promise.resolve();
  return Store.backupData().then(function (d) {
    var gone = (d.settings && d.settings.deletedWorkouts) || [];
    var sig = (d.sessions || []).length + ':' + (d.sessions || []).reduce(function (m, x) { return Math.max(m, x.end || x.start || 0, x.editedAt || 0, x.addedAt || 0); }, 0) + ':' + gone.length;
    if (!force && sig === lastOwnSig) { lastOwnAt = Date.now(); return; }
    return api('PUT', '/api/owner/sessions', {sessions: d.sessions || [], deleted: gone}).then(function () { lastOwnAt = Date.now(); lastOwnSig = sig; });
  }).catch(function () {});
}

/* ---------- a friend's profile page: level, calendar, full Progress (read-only), photos timeline */
var friendCache = {};
function profileView(id) {
  openSheet('<div id="pv"><p class="sub">Loading…</p></div>');
  api('GET', '/api/users/' + encodeURIComponent(id)).then(function (j) {
    if (!$('pv')) return;
    friendCache[id] = j;
    var p = j.profile, u = j.user, h = '<div class="pvh">' + avatar(u, 'big') + '<div><h2 style="margin:0;font-size:24px">' + e(u.name) + (j.mine ? ' <small style="color:var(--dim);font-size:13px">(you, as friends see you)</small>' : '') + '</h2>' +
      '<div class="sub">' + (j.posts ? j.posts + ' post' + (j.posts > 1 ? 's' : '') + ' · ' : '') + (j.updated ? 'updated ' + e(ago(j.updated)) : '') + '</div></div></div>';
    var photos = (j.photos || []).map(function (x) { return {kind: x.kind === 'character' ? 'character' : 'progress', id: x.id, date: x.date, lv: x.lv, src: media(x.url)}; });
    var photosHtml = '<div class="label" style="margin:16px 2px 6px">Progress photos</div><div id="pvPh"></div>';
    function drawPhotos() {
      if ($('pvPh')) GymProfile.timeline($('pvPh'), photos, {key: 'f' + id, editable: false,
        emptyText: (j.mine ? 'You haven’t' : e(u.name) + ' hasn’t') + ' made any photos public.'});
    }
    if (!p) {
      $('pv').innerHTML = h + '<p class="sub" style="margin-top:14px">' + (j.mine ? 'Your stats aren’t shared yet. Open the app once more, or turn on Share my stats in Friends → Profile.' : e(u.name) + ' hasn’t shared their stats yet. They need the latest app version and to open it once.') + '</p>' + photosHtml;
      drawPhotos(); return;
    }
    var tc = ['#5b7a99', '#3ea8ff', '#3ee08f', '#d7ff3e', '#ffb020'], ti = p.score < 0 ? -1 : Math.min(4, Math.floor(p.score)), col = ti < 0 ? '#8d94a0' : tc[ti];
    h += '<div class="pvlv"><div class="pvfig">' + (window.Lifter ? Lifter.svg(p.score) : '') + '</div><div class="pvlvt"><small>Lifter level</small>' +
      '<b class="pvnum">' + p.lv + '</b><span style="color:' + col + ';font-weight:800">' + e(p.tier) + '</span>' +
      '<div class="pvbar"><i style="width:' + Math.round(p.xp * 100) + '%;background:' + col + '"></i></div></div></div>';
    if (p.shared === false) {
      $('pv').innerHTML = h + '<p class="sub" style="margin-top:14px" id="pvHidden">' + (j.mine ? 'Share my stats is off, so friends see only your name and level.' : e(u.name) + ' keeps their stats private: you can see their name and level.') + '</p>' + photosHtml;
      drawPhotos(); return;
    }
    var s = p.stats;
    h += '<div class="pvstats"><div><b>' + s.workouts + '</b><small>workouts</small></div><div><b>' + (s.volume >= 1000 ? Math.round(s.volume / 1000).toLocaleString() + 't' : s.volume + ' kg') + '</b><small>lifted</small></div>' +
      '<div><b>' + s.streak_weeks + '</b><small>week streak</small></div><div><b>' + s.avg_week + '</b><small>per week</small></div></div>';
    h += '<div class="label" style="margin:16px 2px 6px">Training calendar</div><div class="pvcal" id="pvCal"></div>';
    if (p.progress) h += '<button class="log" id="pvProg" style="margin-top:12px">📈 See ' + (j.mine ? 'my' : e(u.name) + '’s') + ' full Progress</button>';
    if (p.muscles.length) h += '<div class="label" style="margin:14px 2px 6px">Muscle levels</div>' + p.muscles.map(function (m) {
      var i = m.score < 0 ? 0 : Math.min(4, Math.floor(m.score)), w = Math.max(4, Math.min(100, (m.score + 1) / 6 * 100));
      return '<div class="pvm"><span>' + e(m.name) + '</span><div><i style="width:' + w + '%;background:' + tc[i] + '"></i></div><small>' + e(m.level) + '</small></div>';
    }).join('');
    h += photosHtml;
    h += '<div class="label" style="margin:14px 2px 6px">Recent workouts</div>' + (p.workouts.length ? p.workouts.map(function (w) {
      return '<div class="pvwd">' + e(w.date) + '</div>' + workoutCard(w);
    }).join('') : '<p class="sub">No workouts yet.</p>');
    $('pv').innerHTML = h;
    // calendar: strictly read-only for friends (no add / edit controls), built with textContent
    GymCal.render($('pvCal'), (p.days || []).map(function (d) { return {date: d.d, title: d.t, minutes: d.m, volume: d.v, sets: d.s}; }),
      {key: 'f' + id, editable: false});
    if ($('pvProg')) $('pvProg').onclick = function () {
      buzz(); closeSheet();
      Progress.openFriend({name: u.name, mine: j.mine, data: p.progress, week: p.week, back: function () { profileView(id); }});
    };
    drawPhotos();
  }).catch(function (err) { if ($('pv')) $('pv').innerHTML = '<p class="sub">' + e(err.message) + '</p>'; });
}

/* ---------- feed */
function feedSheet() {
  openSheet('<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><h2 style="margin:0;font-size:24px">Friends</h2>' +
    '<div class="sbtns" style="flex:none"><button class="pri" id="sNew" style="min-width:0;padding:0 14px">+ Post</button><button id="sFr2" style="min-width:0;padding:0 14px">👥</button></div></div>' +
    '<div id="sFeed"><p class="sub">Loading…</p></div><button class="finish" id="sMore" style="display:none">Load more</button>');
  $('sNew').onclick = function () { shareSheet(null); };
  $('sFr2').onclick = function () { friendsSheet(); };
  var oldest = null;
  function page(before) {
    return api('GET', '/api/feed' + (before ? '?before=' + before : '')).then(function (j) {
      if (!$('sFeed')) return;
      if (!before) $('sFeed').innerHTML = '';
      if (!before && !j.posts.length) $('sFeed').innerHTML = '<p class="sub">Nothing yet. Add friends and share a workout — posts are only visible to you and your friends.</p>';
      $('sFeed').insertAdjacentHTML('beforeend', j.posts.map(postHtml).join(''));
      if (j.posts.length) oldest = j.posts[j.posts.length - 1].created;
      $('sMore').style.display = j.posts.length >= 20 ? '' : 'none';
    }).catch(function (err) { if ($('sFeed')) $('sFeed').innerHTML = '<p class="sub">' + e(err.message) + '</p>'; });
  }
  $('sMore').onclick = function () { page(oldest); };
  $('sFeed').onclick = feedClick;
  page(null);
}
function feedClick(ev) {
  var b = ev.target.closest && ev.target.closest('[data-a]'); if (!b) return;
  var card = b.closest('.spost'), id = card && card.getAttribute('data-id'), a = b.getAttribute('data-a');
  if (a === 'prof') { if (!ev.target.closest('[data-a="del"]')) { buzz(); profileView(b.getAttribute('data-u')); } return; }
  if (a === 'like') {
    buzz();
    api('POST', '/api/posts/' + id + '/like').then(function (j) {
      b.className = j.liked ? 'on' : ''; b.innerHTML = (j.liked ? '♥' : '♡') + ' <span>' + j.likes + '</span>';
    }).catch(function (err) { toast(err.message); });
  } else if (a === 'com') {
    var box = card.querySelector('.scom');
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false; loadComments(card, id);
  } else if (a === 'del') {
    if (!confirm('Delete this post (and its photo, likes and comments)?')) return;
    api('DELETE', '/api/posts/' + id).then(function () { card.remove(); toastOk('Post deleted'); renderHome(); }).catch(function (err) { toast(err.message); });
  } else if (a === 'cdel') {
    api('DELETE', '/api/comments/' + b.getAttribute('data-c')).then(function () { loadComments(card, id); }).catch(function (err) { toast(err.message); });
  } else if (a === 'csend') {
    var inp = card.querySelector('.scin input'), text = inp.value.trim(); if (!text) return;
    api('POST', '/api/posts/' + id + '/comments', {text: text}).then(function () { inp.value = ''; loadComments(card, id); }).catch(function (err) { toast(err.message); });
  }
}
function loadComments(card, id) {
  var box = card.querySelector('.scom');
  api('GET', '/api/posts/' + id + '/comments').then(function (j) {
    box.innerHTML = j.comments.map(function (c) {
      return '<div class="scrow">' + avatar(c.author, 'sm') + '<div><b>' + e(c.author.name) + ' · ' + e(ago(c.created)) + '</b>' + e(c.text).replace(/\n/g, '<br>') + '</div>' +
        (c.can_delete ? '<button data-a="cdel" data-c="' + e(c.id) + '" aria-label="Delete comment">✕</button>' : '') + '</div>';
    }).join('') + '<div class="scin"><input class="txt" maxlength="300" placeholder="Add a comment…"><button data-a="csend">Send</button></div>';
    var n = card.querySelector('[data-a="com"] span'); if (n) n.textContent = j.comments.length;
  }).catch(function (err) { box.innerHTML = '<p class="sub">' + e(err.message) + '</p>'; });
}

/* ---------- share a workout / progress photo */
function latestWorkoutCard(summary) {
  if (!Store.workouts) return Promise.resolve(null);
  return Store.workouts().then(function (l) { return l.length ? Store.workout(l[0].id) : null; }).then(function (w) {
    if (!w) return null;
    return cardFor(w, summary);
  }).catch(function () { return null; });
}
function shareSheet(summary) {
  if (!token) { joinSheet(); return; }
  var blob = null, card = null;
  openSheet('<h2 style="margin:0 0 12px;font-size:24px">Share with friends</h2>' +
    '<label class="stog" id="sIncW" style="display:none"><input type="checkbox" id="sInc"' + (summary ? ' checked' : '') + '><span id="sIncT">Include my latest workout</span></label>' +
    '<div id="sPrevW"></div>' +
    '<textarea class="txt" id="sCap" maxlength="500" placeholder="Say something… (optional)" style="min-height:84px"></textarea>' +
    photoPicker('sPh', '📸 Add a photo') +
    '<button class="log" id="sPost">Post</button><p class="sub" style="font-size:12.5px;margin:8px 0 0">Only you and your friends can see this.</p>');
  wirePicker('sPh', false, function (b) { blob = b; });
  latestWorkoutCard(summary).then(function (c) {
    card = c; if (!c || !$('sIncW')) return;
    $('sIncW').style.display = ''; $('sIncT').textContent = 'Include ' + c.title + ' (' + c.date + ')';
    function show() { $('sPrevW').innerHTML = $('sInc').checked ? workoutCard(c) : ''; }
    $('sInc').onchange = show; show();
  });
  $('sPost').onclick = function () {
    var caption = $('sCap').value.trim(), w = card && $('sInc') && $('sInc').checked ? card : null;
    if (!caption && !w && !blob) { toast('Add a photo, some words or your workout'); return; }
    var btn = this; btn.disabled = true; btn.textContent = blob ? 'Uploading…' : 'Posting…';
    api('POST', '/api/posts', {caption: caption || (w ? '' : '📸'), workout: w}).then(function (j) {
      return blob ? api('PUT', '/api/posts/' + j.post.id + '/photo', undefined, blob) : j;
    }).then(function () {
      buzz([10, 40, 10]); closeSheet(); toastOk('Shared with your friends'); renderHome();
    }).catch(function (err) { toast(err.message); btn.disabled = false; btn.textContent = 'Post'; });
  };
}

/* run fn once the home screen is showing with no sheet open (e.g. after first-run onboarding) */
function whenQuiet(fn) {
  var t = setInterval(function () {
    var sh = $('sheet'), home = $('home');
    if (sh && sh.classList.contains('on')) return;
    if (home && !home.classList.contains('on')) return;
    clearInterval(t); fn();
  }, 1200);
}

/* ---------- boot */
function init() {
  styles();
  var m = location.hash.match(/friend=([A-Za-z0-9-]{8,9})/);
  if (m) pendingInvite = m[1].toUpperCase();
  if (!enabled()) { renderHome(); return Promise.resolve(); }
  var lg = location.hash.match(/social-login=([A-Za-z0-9_-]{20,80})/), loginP = Promise.resolve();
  if (lg) {   // restore a friends login from a one-off link (keep that link private)
    try { history.replaceState(null, '', location.pathname + location.search); } catch (err) {}
    loginP = Promise.all([Store.set('socialToken', lg[1]), Store.set('socialMe', null)]);
  }
  return loginP.then(function () { return Promise.all([Store.get('socialToken'), Store.get('socialMe')]); }).then(function (v) {
    token = v[0] || null; me = v[1] || null;
    renderHome();
    Store.get('socialShare').then(function (x) { shareOn = x !== false; }, function () {});
    if (window.GymProfile) GymProfile.refreshPhotos();
    if (token) api('GET', '/api/me').then(function (j) { remember(null, j.me); if (j.owner) { owner = {dashboard_url: j.dashboard_url || ''}; renderHome(); linkOwner(); } if (pendingInvite) acceptInvite(); setTimeout(sync, 1500); }).catch(function () {});
    else if (pendingInvite) whenQuiet(joinSheet);
  });
}
window.Social = {sync: sync, init: init, renderHome: renderHome, share: shareSheet, feed: feedSheet, friends: friendsSheet,
  joined: function () { return !!token; }, enabled: enabled, profile: profileView,
  sharing: function () { return shareOn; }, setSharing: setSharing, setPhotoPublic: setPhotoPublic, syncPhotos: syncPhotos};
})();
