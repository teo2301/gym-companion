/* Gym Companion - storage + API facade. Public mode keeps everything on the phone
 * (IndexedDB 'gym-companion'), private mode delegates to the server API.
 * Plain ES5 + Promises, no dependencies.
 */
(function (global) {
'use strict';

var DB_NAME = 'gym-companion';
var KEYS = ['bodyweight', 'lastLv', 'lastBackupAt', 'onboarded', 'seedBests', 'routines', 'notes', 'custom', 'snapshot', 'skinTone'];
var LS_KEYS = {
  bodyweight: 'gymBodyweight', lastLv: 'gymLv', lastBackupAt: 'gymLastBackupAt',
  onboarded: 'gymOnboarded', seedBests: 'gymSeedBests', routines: 'gymRoutines',
  notes: 'gymNotes', custom: 'gymCustom', snapshot: 'gymSnapshot', lastBackupNudge: 'gymBackupNudge',
  skinTone: 'gymSkinTone'
};
var UPPER = ['chest', 'front_delts', 'side_delts', 'rear_delts', 'triceps', 'biceps', 'lats', 'upper_back', 'traps', 'forearms', 'abs', 'obliques'];
var LOWER = ['quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'lower_back'];

var _db = null, _dbPromise = null, _noIdb = false, _mem = null;

function core() { return global.GymCore; }
function num(x, d) { var v = parseFloat(x); return isFinite(v) ? v : (d || 0); }
function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
function asArray(v) { return Array.isArray(v) ? v : []; }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function lsGet(k) {
  try { var v = global.localStorage.getItem(k); return decode(v); } catch (e) { return null; }
}
function lsSet(k, v) { try { global.localStorage.setItem(k, encode(v)); } catch (e) {} }
function decode(v) {
  if (v == null) return null;
  try { return JSON.parse(v); } catch (e) {}
  return /^-?\d+(\.\d+)?$/.test(String(v)) ? parseFloat(v) : String(v);
}
function encode(v) { return typeof v === 'string' ? v : JSON.stringify(v == null ? null : v); }

/* ---------- tiny Promise IndexedDB wrapper ---------- */

function openDb() {
  if (_db) return Promise.resolve(_db);
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise(function (resolve, reject) {
    if (!global.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    var req;
    try { req = global.indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', {keyPath: 'id'});
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', {keyPath: 'k'});
    };
    req.onsuccess = function () { _db = req.result; resolve(_db); };
    req.onerror = function () { reject(req.error || new Error('IndexedDB open failed')); };
  });
  return _dbPromise.catch(function (e) { _dbPromise = null; throw e; });
}
function idb(storeName, mode, fn) {
  return openDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx, req;
      try {
        tx = db.transaction(storeName, mode);
        req = fn(tx.objectStore(storeName));
      } catch (e) { reject(e); return; }
      // Resolve on commit, not on request success, so a "saved" set really is on disk.
      tx.oncomplete = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB request failed')); };
      tx.onabort = function () { reject(tx.error || new Error('IndexedDB aborted')); };
    });
  });
}
// Fallback for WebViews with storage disabled: memory backed by localStorage.
function mem() {
  if (!_mem) {
    _mem = {kv: lsGet('gymLocalKV') || {}, sessions: asArray(lsGet('gymLocalSessions'))};
    if (!_mem.kv || typeof _mem.kv !== 'object') _mem.kv = {};
  }
  return _mem;
}
function memSave() { lsSet('gymLocalKV', mem().kv); lsSet('gymLocalSessions', mem().sessions); }
function kvGet(k) {
  if (_noIdb) return Promise.resolve(clone(mem().kv[k]));
  return idb('kv', 'readonly', function (s) { return s.get(k); }).then(function (row) {
    return row ? clone(row.v) : null;
  }).catch(function () { _noIdb = true; return clone(mem().kv[k]); });
}
function kvSet(k, v) {
  if (_noIdb) { mem().kv[k] = clone(v); memSave(); return Promise.resolve(v); }
  return idb('kv', 'readwrite', function (s) { return s.put({k: k, v: clone(v)}); })
    .then(function () { return v; })
    .catch(function () { _noIdb = true; mem().kv[k] = clone(v); memSave(); return v; });
}
function sessionsAll() {
  if (_noIdb) return Promise.resolve(clone(mem().sessions));
  return idb('sessions', 'readonly', function (s) { return s.getAll(); })
    .then(function (rows) { return asArray(rows).map(clone); })
    .catch(function () { _noIdb = true; return clone(mem().sessions); });
}
function sessionPut(s) {
  if (_noIdb) {
    var old = mem().sessions.filter(function (x) { return x.id !== s.id; });
    old.push(clone(s)); mem().sessions = old; memSave(); return Promise.resolve(s);
  }
  return idb('sessions', 'readwrite', function (st) { return st.put(clone(s)); })
    .catch(function () { _noIdb = true; return sessionPut(s); });
}
function sessionDelete(id) {
  if (_noIdb) { mem().sessions = mem().sessions.filter(function (x) { return x.id !== id; }); memSave(); return Promise.resolve(); }
  return idb('sessions', 'readwrite', function (s) { return s.delete(id); });
}
function sessionsClear() {
  if (_noIdb) { mem().sessions = []; memSave(); return Promise.resolve(); }
  return idb('sessions', 'readwrite', function (s) { return s.clear(); })
    .catch(function () { _noIdb = true; return sessionsClear(); });
}

/* ---------- HTTP + file helpers ---------- */

function fetchJson(url, opts) {
  return fetch(url, opts).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}
function postJson(url, obj) {
  return fetchJson(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(obj || {})});
}
function mimeFor(name) {
  return /\.json$/i.test(name) ? 'application/json' : /\.csv$/i.test(name) ? 'text/csv' : 'text/plain';
}
// iPhone/iPad: download links are unreliable (worst in Home Screen apps), so use the share sheet
// ("Save to Files"). iOS only opens it straight from a tap, and the data is prepared asynchronously,
// so show a one-button prompt whose tap opens the sheet.
function isIOS() {
  var ua = global.navigator ? navigator.userAgent : '';
  return /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
function shareFile(name, text) {
  var file;
  try { file = new File([text], name, {type: mimeFor(name)}); } catch (e) { return null; }
  if (!navigator.canShare || !navigator.share || !navigator.canShare({files: [file]})) return null;
  return new Promise(function (resolve) {
    var bg = document.createElement('div');
    bg.setAttribute('style', 'position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.6);display:flex;' +
      'align-items:flex-end;justify-content:center;padding:16px 16px calc(16px + env(safe-area-inset-bottom))');
    bg.innerHTML = '<div style="width:100%;max-width:420px;background:#181c23;border-radius:20px;padding:20px;' +
      'color:#eef0f3;font:16px/1.4 system-ui,-apple-system,sans-serif">' +
      '<b style="font-size:19px">Your file is ready</b><p style="color:#8d94a0;margin:6px 0 16px">' +
      name.replace(/[<>&"]/g, '') + ' \u00b7 choose <b>Save to Files</b> to keep it.</p>' +
      '<button data-a="go" style="width:100%;padding:14px;border:0;border-radius:14px;background:#d7ff3e;' +
      'color:#0c0e12;font:600 17px system-ui,-apple-system,sans-serif">Save\u2026</button>' +
      '<button data-a="x" style="width:100%;padding:12px;margin-top:6px;border:0;background:none;color:#8d94a0;' +
      'font:16px system-ui,-apple-system,sans-serif">Cancel</button></div>';
    function done(v) { if (bg.parentNode) bg.parentNode.removeChild(bg); resolve(v); }
    bg.onclick = function (e) {
      var a = e.target && e.target.getAttribute && e.target.getAttribute('data-a');
      if (e.target === bg || a === 'x') { done(false); return; }
      if (a !== 'go') return;
      navigator.share({files: [file], title: name})               // inside the tap, as iOS requires
        .then(function () { done(true); }, function () { done(false); });
    };
    document.body.appendChild(bg);
  });
}
function saveFile(name, text) {
  if (global.GymBridge && typeof global.GymBridge.saveFile === 'function')
    return Promise.resolve(global.GymBridge.saveFile(name, text));
  if (isIOS()) { var shared = shareFile(name, text); if (shared) return shared; }
  return new Promise(function (resolve, reject) {
    try {
      var blob = new Blob([text], {type: mimeFor(name) + ';charset=utf-8'});
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) {} a.parentNode.removeChild(a); }, 1500);
      resolve(true);
    } catch (e) { reject(e); }
  });
}
function pickFile() {
  return new Promise(function (resolve, reject) {
    if (global.GymBridge && typeof global.GymBridge.pickFile === 'function') {
      global.GymFilePicked = function (text) { resolve(String(text == null ? '' : text)); };
      try { global.GymBridge.pickFile('GymFilePicked'); }
      catch (e) {
        try { global.GymBridge.pickFile(); }
        catch (e2) { reject(e2); }
      }
      return;
    }
    var input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,.csv,text/plain'; input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) { reject(new Error('No file selected')); return; }
      var fr = new FileReader();
      fr.onload = function () {
        try { input.parentNode.removeChild(input); } catch (e) {}
        resolve(String(fr.result || ''));
      };
      fr.onerror = function () { reject(fr.error || new Error('Could not read file')); };
      fr.readAsText(f);
    };
    input.click();
  });
}

/* ---------- shared helpers ---------- */

function eValue(v) {
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return num(v[0]);
  if (v && typeof v === 'object') return num(has(v, 'e1rm') ? v.e1rm : v.est_1rm);
  return 0;
}
function has(o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); }
function cfgObject(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && v.templates && typeof v.templates === 'object')
    return {templates: clone(v.templates), hidden: asArray(v.hidden).slice()};
  if (Array.isArray(v)) {
    var out = {templates: {}, hidden: []};
    v.forEach(function (r) { if (r && r.name) out.templates[r.name] = asArray(r.exercises); });
    return out;
  }
  return {templates: (v && typeof v === 'object') ? clone(v) : {}, hidden: []};
}
function bestsFromMaxes(maxes) {
  var out = {}, today = new Date().toISOString().slice(0, 10), name, m;
  for (name in (maxes || {})) {
    if (!has(maxes, name)) continue;
    m = maxes[name] || {};
    out[name] = {e1rm: core().e1rm(m.w, m.r), w: num(m.w), r: num(m.r), date: today};
  }
  return out;
}
function starterRoutines(maxes, existing) {
  var cfg = cfgObject(existing);
  if (Object.keys(cfg.templates).length) return cfg;
  var names = Object.keys(maxes || {}), upper = [], lower = [], i, mm;
  for (i = 0; i < names.length; i++) {
    mm = core().musclesFor(names[i]).primary;
    if (mm.some(function (m) { return UPPER.indexOf(m) >= 0; })) upper.push(names[i]);
    if (mm.some(function (m) { return LOWER.indexOf(m) >= 0; })) lower.push(names[i]);
  }
  cfg.templates['Full Body'] = names.slice(0, 8);
  cfg.templates['Upper'] = upper.length ? upper : names.slice(0, 4);
  cfg.templates['Lower'] = lower.length ? lower : names.slice(0, 4);
  Object.keys(cfg.templates).forEach(function (k) { if (!cfg.templates[k].length) delete cfg.templates[k]; });
  return cfg;
}
function stateOut(liveState) {
  var s = liveState || {version: 0, session: null};
  var out = {version: num(s.version), session: s.session || null, server_time: Date.now()};
  if (out.session && !out.session.finished && core()) {
    try { out.summary = core().summary(out.session); } catch (e) {}
  }
  return out;
}

/* ---------- public (offline, on-phone) store ---------- */

// Preset exercise library for offline mode (the private server merges it in server-side). A missing
// file only means no presets; the app still works.
function loadPresets() {
  if (typeof fetch !== 'function') return Promise.resolve(0);
  return fetch('exercises.json').then(function (r) { return r.ok ? r.json() : {exercises: []}; })
    .then(function (d) { return core().setPresets(d && d.exercises); })
    .catch(function () { return 0; });
}
function refreshCache(c) {
  return Promise.all([kvGet('bodyweight'), kvGet('seedBests'), kvGet('routines'),
    kvGet('notes'), kvGet('custom'), kvGet('lastLv'), sessionsAll()]).then(function (v) {
    c.bodyweight = v[0] == null ? 75 : num(v[0], 75);
    c.seedBests = v[1] || {};
    c.routines = cfgObject(v[2]);
    c.notes = v[3] || {};
    c.custom = asArray(v[4]);
    c.lastLv = v[5] == null ? 0 : num(v[5]);
    c.sessions = asArray(v[6]).sort(function (a, b) {
      return num(a.started != null ? a.started : a.start) - num(b.started != null ? b.started : b.start);
    });
    return c;
  });
}
function planArgs(c) {
  return {sessions: c.sessions, routines: c.routines, notes: c.notes, custom: c.custom,
    bodyweight: c.bodyweight, seedBests: c.seedBests};
}
function ctxFor(c) {
  return {
    plan: function () { return core().buildPlan(planArgs(c)); },
    newExercise: function (n) { return core().newExercise(n, {notes: function () { return c.notes || {}; },
      custom: function () { return c.custom || []; }}); },
    notes: function () { return c.notes || {}; },
    custom: function () { return c.custom || []; },
    now: function () { return Date.now(); }
  };
}
function publicSettings() {
  return Promise.all(KEYS.map(function (k) { return kvGet(k); })).then(function (vals) {
    var out = {};
    KEYS.forEach(function (k, i) { out[k] = vals[i]; });
    return out;
  });
}

function makePublic(c) {
  var store = {mode: 'public', saveFile: saveFile, pickFile: pickFile};

  store.get = function (k) { return kvGet(k); };
  store.set = function (k, v) { return kvSet(k, v); };
  store.settings = function () { return publicSettings(); };

  store.plan = function () {
    return refreshCache(c).then(function () { return core().buildPlan(planArgs(c)); });
  };
  store.progress = function () {
    return refreshCache(c).then(function () {
      return core().progress({sessions: c.sessions, seedBests: c.seedBests, bodyweight: c.bodyweight,
        custom: c.custom});
    });
  };
  store.live = function () { return kvGet('live').then(stateOut); };

  /* ---------- past workouts: list, open, edit, delete (all on-device) */
  function workoutJson(raw) {
    var n = core().normalizeSession(raw), exs = [], vol = 0, sets = 0;
    Object.keys(n.exercises).forEach(function (name) {
      var ss = n.exercises[name].map(function (x) { vol += x.weight_kg * x.reps; sets++; return {w: x.weight_kg, r: x.reps, type: x.set_type === 'warmup' ? 'warmup' : 'normal'}; });
      // warm-ups first, as they were done
      ss.sort(function (a, b) { return (a.type === 'warmup' ? 0 : 1) - (b.type === 'warmup' ? 0 : 1); });
      if (ss.length) exs.push({name: name, sets: ss});   // routine exercises that were never done aren't part of it
    });
    return {id: raw.id, source: 'device', editable: true, title: n.title, date_str: n.date_str, start: n.start,
      duration_min: n.duration_min, total_sets: sets, total_volume_kg: Math.round(vol), exercises: exs};
  }
  store.workouts = function () {
    return sessionsAll().then(function (all) {
      return asArray(all).filter(function (s) { return s && s.id; }).map(function (s) {
        var w = workoutJson(s); delete w.exercises; return w;
      }).sort(function (a, b) { return b.start - a.start; });
    });
  };
  store.workout = function (id) {
    return sessionsAll().then(function (all) {
      var raw = asArray(all).filter(function (s) { return s && s.id === id; })[0];
      return raw ? workoutJson(raw) : Promise.reject(new Error('workout not found'));
    });
  };
  store.saveWorkout = function (id, edit) {
    return sessionsAll().then(function (all) {
      var raw = asArray(all).filter(function (s) { return s && s.id === id; })[0];
      if (!raw) return {ok: false, error: 'workout not found'};
      var n = core().normalizeSession(raw), ex = {}, any = false;
      asArray(edit && edit.exercises).forEach(function (e) {
        var name = String((e && e.name) || '').trim().slice(0, 80); if (!name) return;
        var sets = asArray(e.sets).map(function (x, i) {
          return {weight_kg: Math.max(0, Math.min(1000, num(x.w))), reps: Math.max(0, Math.min(1000, Math.round(num(x.r)))),
            set_type: x.type === 'warmup' ? 'warmup' : 'normal', set_index: i};
        }).filter(function (x) { return x.reps > 0; });
        if (sets.length) { ex[name] = (ex[name] || []).concat(sets); any = true; }
      });
      if (!any) return {ok: false, error: 'A workout needs at least one set \u2014 delete it instead'};
      // canonical (Hevy-like) shape; same id, start and end, so history order and identity are kept
      var saved = {id: raw.id, title: String((edit && edit.title) || n.title).trim().slice(0, 60) || n.title,
        start: n.start, end: n.end, date_str: n.date_str, exercises: ex, savedAt: raw.savedAt || Date.now(), editedAt: Date.now()};
      return sessionPut(saved).then(function () { return refreshCache(c); })
        .then(function () { return store.snapshot(); }).then(function () { return {ok: true, id: raw.id}; });
    });
  };
  store.deleteWorkout = function (id) {
    return sessionDelete(id).then(function () { return refreshCache(c); })
      .then(function () { return store.snapshot(); }).then(function () { return {ok: true}; });
  };
  store.history = function (name) {
    return refreshCache(c).then(function () {
      return core().history(name, {sessions: c.sessions, notes: c.notes, custom: c.custom});
    });
  };

  store.op = function (o) {
    var ops = o && o.ops ? o.ops : [o];
    return kvGet('appliedOps').then(function (applied) {
      applied = asArray(applied).slice();
      var result = null, chain = Promise.resolve();
      ops.forEach(function (raw) {
        chain = chain.then(function () {
          if (!raw || !raw.op) return;
          var id = raw.id || uid();
          if (applied.indexOf(id) >= 0) return;   // replay-safe, like the server
          applied.push(id);
          return kvGet('live').then(function (liveState) {
            var state = liveState || {version: 0, session: null};
            var next = core().applyOp(state, clone(raw), ctxFor(c));
            var version = num(state.version) + 1;
            var out = {version: version, session: next.session || null, server_time: Date.now()};
            if (out.session && !out.session.finished) {
              try { out.summary = core().summary(out.session); } catch (e) {}
            }
            return kvSet('live', {version: version, session: out.session}).then(function () {
              if (raw.op === 'finish' && out.session && out.session.finished) {
                var sess = clone(out.session);
                if (!sess.id) sess.id = uid();
                sess.savedAt = Date.now();
                return sessionPut(sess).then(function () { return store.snapshot(); });
              }
              if (raw.op === 'discard') return kvSet('live', {version: version, session: null});
            }).then(function () { result = out; });
          });
        });
      });
      return chain.then(function () {
        return kvSet('appliedOps', applied.slice(-500)).then(function () {
          return refreshCache(c).then(function () {
            return result || kvGet('live').then(stateOut);
          });
        });
      });
    });
  };

  store.note = function (name, text) {
    name = String(name || '').trim(); text = String(text || '').trim().slice(0, 300);
    if (!name) return Promise.resolve({ok: false});
    return kvGet('notes').then(function (notes) {
      notes = notes || {};
      if (text) notes[name] = text; else delete notes[name];
      return kvSet('notes', notes).then(function () {
        return kvGet('live').then(function (liveState) {
          if (!liveState || !liveState.session) return;
          liveState.session.exercises.forEach(function (e) { if (e.name === name) e.note = text; });
          liveState.version = num(liveState.version) + 1;
          return kvSet('live', liveState);
        });
      });
    }).then(function () { return refreshCache(c).then(function () { return {ok: true}; }); });
  };

  store.routine = function (payload) {
    payload = payload || {};
    var name = String(payload.name || '').trim().slice(0, 40);
    if (!name) return Promise.resolve({ok: false, error: 'name needed'});
    return kvGet('routines').then(function (raw) {
      var cfg = cfgObject(raw), old = String(payload.old_name || '').trim();
      if (payload['delete']) {
        delete cfg.templates[name];
        if (cfg.hidden.indexOf(name) < 0) cfg.hidden.push(name);
      } else {
        var exs = asArray(payload.exercises).map(function (x) { return String(x || '').trim(); }).filter(Boolean).slice(0, 20);
        if (!exs.length) return {ok: false, error: 'add at least one exercise'};
        cfg.templates[name] = exs;
        var hi = cfg.hidden.indexOf(name);
        if (hi >= 0) cfg.hidden.splice(hi, 1);
        if (old && old !== name) {
          delete cfg.templates[old];
          if (cfg.hidden.indexOf(old) < 0) cfg.hidden.push(old);
        }
      }
      return kvSet('routines', cfg).then(function () { return {ok: true}; });
    }).then(function (out) {
      return refreshCache(c).then(function () { return out; });
    });
  };

  store.customExercise = function (payload) {
    var name = typeof payload === 'string' ? payload : ((payload && payload.name) || '');
    name = String(name).trim().slice(0, 80);
    if (!name) return Promise.resolve({ok: false, error: 'name needed'});
    return kvGet('custom').then(function (custom) {
      custom = asArray(custom);
      var found = custom.filter(function (x) { return (typeof x === 'string' ? x : x && x.name) === name; })[0];
      if (!found) {
        found = (payload && typeof payload === 'object' && payload.name) ? clone(payload) : name;
        if (typeof found === 'object') found.name = name;
        custom.push(found);
      }
      return kvSet('custom', custom).then(function () {
        // A reference max is a rated lift: seed it so the level engine can use it.
        var ref = (found && typeof found === 'object' && found.ref_max) || null;
        if (!ref || num(ref.w) <= 0 || num(ref.r) <= 0) return null;
        var today = new Date().toISOString().slice(0, 10);
        return kvGet('seedBests').then(function (seed) {
          seed = seed || {};
          seed[name] = {e1rm: core().e1rm(ref.w, ref.r), w: num(ref.w), r: num(ref.r), date: today};
          return kvSet('seedBests', seed);
        });
      }).then(function () { return {ok: true, name: name}; });
    }).then(function (out) { return refreshCache(c).then(function () { return out; }); });
  };

  store.onboard = function (o) {
    o = o || {};
    var bw = num(o.bodyweight, 75) || 75, seed = bestsFromMaxes(o.maxes);
    return refreshCache(c).then(function () {
      var cfg = starterRoutines(o.maxes, c.routines);
      return Promise.all([kvSet('bodyweight', bw), kvSet('seedBests', seed),
        kvSet('onboarded', true), kvSet('routines', cfg)])
        .then(function () { return refreshCache(c).then(function () { return {ok: true, seedBests: seed, routines: cfg}; }); });
    });
  };

  store.backupData = function () {
    return Promise.all([kvGet('seedBests'), sessionsAll(), kvGet('routines'), kvGet('notes'),
      kvGet('custom'), kvGet('bodyweight'), kvGet('lastLv'), publicSettings()]).then(function (v) {
      var settings = v[7] || {}; settings.snapshot = null;  // don't nest snapshots inside snapshots
      return {schemaVersion: 1, appVersion: global.GYM_APP_VERSION || 'gym-companion-1',
        exportedAt: new Date().toISOString(), seedBests: v[0] || {}, sessions: asArray(v[1]),
        routines: v[2] || {templates: {}, hidden: []}, notes: v[3] || {},
        customExercises: asArray(v[4]), bodyweight: v[5] == null ? 75 : v[5],
        lastLv: v[6] == null ? 0 : v[6], settings: settings};
    });
  };
  store.restore = function (data, strategy) {
    if (!data || data.schemaVersion !== 1) return Promise.resolve({ok: false, error: 'Unsupported backup'});
    strategy = strategy === 'replace' ? 'replace' : 'merge';
    var counts = {sessions: 0, sessionsAdded: 0, seedBests: 0, routines: 0, notes: 0, custom: 0};
    return Promise.all([sessionsAll(), kvGet('seedBests'), kvGet('routines'), kvGet('notes'),
      kvGet('custom'), kvGet('bodyweight'), kvGet('lastLv')]).then(function (v) {
      var existing = asArray(v[0]), incoming = asArray(data.sessions), next = {}, tasks = [];
      counts.sessions = incoming.length;
      var pick = function (key, fallback) {
        if (has(data, key)) return data[key];
        return data.settings && has(data.settings, key) ? data.settings[key] : fallback;
      };
      if (strategy === 'replace') {
        next.sessions = incoming.map(function (s) { var z = clone(s); if (!z.id) z.id = uid(); return z; });
        next.seedBests = clone(data.seedBests || {});
        next.routines = cfgObject(data.routines);
        next.notes = clone(data.notes || {});
        next.custom = asArray(data.customExercises || data.custom);
        next.bodyweight = pick('bodyweight', 75);
        next.lastLv = pick('lastLv', 0);
        next.skinTone = pick('skinTone', null);
        counts.sessionsAdded = next.sessions.length;
        // Clear strictly before writing, so the restored sessions can never be wiped by the clear.
        tasks.push(sessionsClear().then(function () {
          return Promise.all(next.sessions.map(function (s) { return sessionPut(s); }));
        }));
        tasks.push(kvSet('live', {version: 0, session: null}));
      } else {
        var byId = {}, added = [];
        existing.forEach(function (s) { if (s.id) byId[s.id] = s; });
        incoming.forEach(function (s) {
          var z = clone(s); if (!z.id) z.id = uid();
          if (!byId[z.id]) { byId[z.id] = z; added.push(z); }
        });
        next.sessions = Object.keys(byId).map(function (id) { return byId[id]; });
        counts.sessionsAdded = added.length;
        next.seedBests = clone(v[1] || {});
        Object.keys(data.seedBests || {}).forEach(function (n) {
          if (!has(next.seedBests, n) || eValue(data.seedBests[n]) > eValue(next.seedBests[n]))
            next.seedBests[n] = clone(data.seedBests[n]);
        });
        var cfgA = cfgObject(v[2]), cfgB = cfgObject(data.routines);
        Object.keys(cfgB.templates).forEach(function (n) { cfgA.templates[n] = cfgB.templates[n]; });
        cfgB.hidden.forEach(function (n) { if (cfgA.hidden.indexOf(n) < 0) cfgA.hidden.push(n); });
        next.routines = cfgA;
        next.notes = clone(v[3] || {});
        Object.keys(data.notes || {}).forEach(function (n) { if (!next.notes[n]) next.notes[n] = data.notes[n]; });
        next.custom = asArray(v[4]).slice();
        asArray(data.customExercises || data.custom).forEach(function (c) {
          var n = typeof c === 'string' ? c : (c && c.name);
          if (n && !next.custom.some(function (x) { return (typeof x === 'string' ? x : x && x.name) === n; })) next.custom.push(c);
        });
        next.bodyweight = v[5] == null ? pick('bodyweight', 75) : v[5];
        next.lastLv = v[6] == null ? pick('lastLv', 0) : v[6];
        var tn = pick('skinTone', null); if (tn) next.skinTone = tn;   // merge: keep yours unless the backup has one
        added.forEach(function (s) { tasks.push(sessionPut(s)); });
      }
      counts.seedBests = Object.keys(next.seedBests).length;
      counts.routines = Object.keys(next.routines.templates || {}).length;
      counts.notes = Object.keys(next.notes || {}).length;
      counts.custom = next.custom.length;
      KEYS.forEach(function (key) { if (has(next, key)) tasks.push(kvSet(key, next[key])); });
      tasks.push(kvSet('onboarded', true));
      return Promise.all(tasks);
    }).then(function () {
      return refreshCache(c).then(function () { return {ok: true, counts: counts}; });
    });
  };
  store.snapshot = function () {
    // Keep a fresh local copy; this is not the same as an exported file backup.
    return store.backupData().then(function (data) { return kvSet('snapshot', data); });
  };
  return store;
}

/* ---------- private (server-backed) store ---------- */

function makePrivate() {
  var store = {mode: 'private', saveFile: saveFile, pickFile: pickFile};
  store.get = function (k) { return Promise.resolve(lsGet(LS_KEYS[k] || ('gym' + k))); };
  store.set = function (k, v) { lsSet(LS_KEYS[k] || ('gym' + k), v); return Promise.resolve(v); };
  store.settings = function () {
    var out = {};
    KEYS.forEach(function (k) { out[k] = lsGet(LS_KEYS[k]); });
    return Promise.resolve(out);
  };
  store.plan = function () { return fetchJson('../api/gym/plan'); };
  store.progress = function () { return fetchJson('../api/gym/progress'); };
  store.live = function (v) {
    var wait = global.GYM_NO_POLL ? 0 : 25;
    return fetchJson('../api/gym/live?v=' + encodeURIComponent(v == null ? -1 : v) + '&wait=' + wait);
  };
  store.op = function (o) {
    var body = o && o.ops ? o : {ops: [o]};
    return postJson('../api/gym/op', body);
  };
  store.history = function (name) { return fetchJson('../api/gym/history?name=' + encodeURIComponent(name || '')); };
  store.workouts = function () { return fetchJson('../api/gym/workouts'); };
  store.workout = function (id) { return fetchJson('../api/gym/workouts?id=' + encodeURIComponent(id)); };
  // read the JSON even on 4xx, so the server's reason (e.g. Hevy imports are read-only) reaches the user
  function postWorkout(body) {
    return fetch('../api/gym/workout', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})
      .then(function (r) { return r.json().catch(function () { return {ok: false, error: 'HTTP ' + r.status}; }); });
  }
  store.saveWorkout = function (id, edit) { return postWorkout({id: id, title: edit.title, exercises: edit.exercises}); };
  store.deleteWorkout = function (id) { return postWorkout({id: id, delete: true}); };
  store.note = function (name, text) { return postJson('../api/gym/note', {name: name, text: text}); };
  store.routine = function (payload) { return postJson('../api/gym/routine', payload); };
  store.customExercise = function (payload) { return postJson('../api/gym/custom', payload); };
  store.onboard = function (o) {
    o = o || {};
    var seed = bestsFromMaxes(o.maxes);
    lsSet(LS_KEYS.bodyweight, num(o.bodyweight, 75) || 75);
    lsSet(LS_KEYS.seedBests, seed);
    lsSet(LS_KEYS.onboarded, true);
    return Promise.resolve({ok: true, seedBests: seed});
  };
  store.backupData = function () { return fetchJson('../api/gym/backup'); };
  store.restore = function (data, strategy) {
    return postJson('../api/gym/restore', {data: data, strategy: strategy || 'merge'})
      .catch(function () { return {ok: false, error: 'Server restore unavailable'}; });
  };
  store.snapshot = function () { return Promise.resolve(null); };  // server already persists
  return store;
}

global.GymStore = {
  create: function (options) {
    options = options || {};
    var mode = options.mode || (global.GYM_PUBLIC ? 'public' : null) ||
      (typeof location !== 'undefined' && location.hash.indexOf('#public') === 0 ? 'public' : 'private');
    if (mode !== 'public' && mode !== 'private') mode = 'private';
    if (mode === 'private') return Promise.resolve(makePrivate());
    var c = {sessions: [], bodyweight: 75, seedBests: {}, routines: {templates: {}, hidden: []},
      notes: {}, custom: [], lastLv: 0};
    var store = makePublic(c);
    return Promise.all([refreshCache(c), loadPresets()]).then(function () { return store; });
  }
};
})(window);
