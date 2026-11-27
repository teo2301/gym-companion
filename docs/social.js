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
var token = null, me = null, pendingInvite = null, feedCache = [];

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
  if (m) { me = m; Store.set('socialMe', m); }
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
    '<div class="sph">' + avatar(p.author) + '<div class="spn"><b>' + e(p.author.name) + '</b><small>' + e(ago(p.created)) + '</small></div>' +
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
    '.stog{display:flex;align-items:center;gap:10px;background:var(--card);border-radius:14px;padding:12px;margin-bottom:10px;font-size:15px}.stog input{width:22px;height:22px;accent-color:#d7ff3e}'
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
    '<button class="pri" id="sOpen">Open feed</button><button id="sFriends">👥 Friends</button></div></div>';
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
    '<button class="log" id="sGo">Join</button>');
  wirePicker('sAva', true, function (b) { blob = b; });
  $('sGo').onclick = function () {
    var name = $('sName').value.trim(); if (!name) { toast('Pick a name'); return; }
    this.disabled = true;
    api('POST', '/api/register', {name: name}).then(function (j) {
      remember(j.token, j.me);
      return blob ? api('PUT', '/api/me/avatar', undefined, blob).then(function (k) { remember(null, k.me); }) : null;
    }).then(function () {
      closeSheet(); toastOk('Welcome, ' + me.name); renderHome();
      if (pendingInvite) setTimeout(acceptInvite, 300); else setTimeout(friendsSheet, 300);
    }).catch(function (err) { toast(err.message); $('sGo').disabled = false; });
  };
}
function profileSheet() {
  var blob = null;
  openSheet('<h2 style="margin:0 0 12px;font-size:24px">Your profile</h2>' +
    '<div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">' + avatar(me, 'big') + '<div style="flex:1">' + photoPicker('sAva2', 'Change photo') + '</div></div>' +
    '<input class="txt" id="sName2" maxlength="30" value="' + e(me.name) + '">' +
    '<button class="log" id="sSaveP">Save</button>' +
    '<button class="finish" id="sReset">Get a new friend code</button>' +
    '<button class="danger" id="sDelAcc">Delete my account and all my posts</button>');
  wirePicker('sAva2', true, function (b) { blob = b; });
  $('sSaveP').onclick = function () {
    var name = $('sName2').value.trim();
    var jobs = [];
    if (name && name !== me.name) jobs.push(api('POST', '/api/me', {name: name}).then(function (j) { remember(null, j.me); }));
    if (blob) jobs.push(api('PUT', '/api/me/avatar', undefined, blob).then(function (j) { remember(null, j.me); }));
    Promise.all(jobs).then(function () { closeSheet(); toastOk('Profile saved'); renderHome(); }).catch(function (err) { toast(err.message); });
  };
  $('sReset').onclick = function () {
    if (!confirm('Make a new friend code? Your old code and invite links stop working (current friends stay).')) return;
    api('POST', '/api/me/code').then(function (j) { remember(null, j.me); toastOk('New code: ' + j.me.code); friendsSheet(); }).catch(function (err) { toast(err.message); });
  };
  $('sDelAcc').onclick = function () {
    if (!confirm('Delete your friends account? All your posts, photos, likes and comments are removed for good. Your workouts in this app are NOT affected.')) return;
    api('DELETE', '/api/me').then(function () { closeSheet(); forget(); toastOk('Account deleted'); }).catch(function (err) { toast(err.message); });
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
      return '<div class="sfr">' + avatar(f) + '<b>' + e(f.name) + '</b><button data-id="' + e(f.id) + '" data-n="' + e(f.name) + '">Remove</button></div>';
    }).join('') : '<p class="sub">No friends yet. Share your invite, or type a friend’s code above.</p>';
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
    var lifts = w.exercises.map(function (x) {
      var work = x.sets.filter(function (s) { return s.type !== 'warmup'; }); if (!work.length) return null;
      var top = work.reduce(function (a, b) { return b.w > a.w || (b.w === a.w && b.r > a.r) ? b : a; });
      return {name: x.name, w: top.w, r: top.r, sets: work.length, vol: work.reduce(function (t, s) { return t + s.w * s.r; }, 0)};
    }).filter(Boolean).sort(function (a, b) { return b.vol - a.vol; }).slice(0, 4);
    var o = (window.prog && prog.overall) || {};
    return {title: w.title, date: w.date_str, minutes: (summary && summary.minutes) || w.duration_min, sets: (summary && summary.sets) || w.total_sets,
      volume: (summary && summary.volume) || w.total_volume_kg, lv: o.lv || 0, tier: o.tier || '',
      lifts: lifts.map(function (l) { return {name: l.name, w: l.w, r: l.r, sets: l.sets}; }),
      prs: ((summary && summary.prs) || []).map(function (p) { return p.ex + ' ' + kg(p.w) + ' kg × ' + p.r; })};
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
  return Promise.all([Store.get('socialToken'), Store.get('socialMe')]).then(function (v) {
    token = v[0] || null; me = v[1] || null;
    renderHome();
    if (token) api('GET', '/api/me').then(function (j) { remember(null, j.me); if (pendingInvite) acceptInvite(); }).catch(function () {});
    else if (pendingInvite) whenQuiet(joinSheet);
  });
}
window.Social = {init: init, renderHome: renderHome, share: shareSheet, feed: feedSheet, friends: friendsSheet,
  joined: function () { return !!token; }, enabled: enabled};
})();
