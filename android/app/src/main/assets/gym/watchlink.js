/* Watch link (Android app only): the phone side of the Wear OS Data Layer protocol (WATCH_LINK_SPEC.md).
 *
 * The watch queues actions as Data Layer items. The native app (WearListener) validates them and parks them in a
 * small queue file; this script drains that queue into whatever store the page uses (the on-device store for
 * everybody, the owner's server store for the owner), acknowledges them, then publishes the current live workout
 * and plan back to the watch. JavaScript cannot reach the Data Layer itself, so it goes through
 * window.GymWatchNative (added to the WebView by the Android app; absent in browsers, so this file is then inert).
 *
 * Only the plan, the live session and the level are ever published. Nothing about sex, cycle, height, weight,
 * photos or friends goes to the watch.
 * ES5 on purpose (same as the rest of the app). */
(function (g) {
'use strict';
var N = g.GymWatchNative;
if (!N) return;

var running = false, again = false, quiet = false, timer = null, retry = null, attached = null;
var lastLive = '', lastPlan = '';
var MAX_ITEM = 90000;          // a Data Layer item is limited to 100 KB

function parse(s, d) { try { return JSON.parse(s); } catch (e) { return d; } }
function S() { return g.Store || null; }

function byTime(a, b) {
  var d = (a.t || 0) - (b.t || 0);
  return d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/* routine exercises are the bulk of the plan: keep only what the watch screens use, and shrink further if needed */
function slimRoutines(list, level) {
  return (list || []).slice(0, level >= 2 ? 8 : 20).map(function (r) {
    return {name: r.name, count: r.count, last_date: r.last_date, last_volume: r.last_volume, last_minutes: r.last_minutes,
      exercises: (r.exercises || []).map(function (x) {
        var o = {name: x.name, last: x.last, target: x.target, step: x.step, warmup: x.warmup, rest: x.rest, best: x.best, group: x.group};
        if (level < 1) { o.why = x.why; o.note = x.note; o.muscles = x.muscles; o.last_date = x.last_date; }
        return o;
      })};
  });
}

function publishLive(s) {
  return s.live(-1).then(function (st) {
    if (!st) return;
    var out = {version: st.version, session: st.session || null, server_time: st.server_time || Date.now()};
    if (st.summary) out.summary = st.summary;
    var key = JSON.stringify({v: out.version, s: out.session});
    if (key === lastLive) return;
    var str = JSON.stringify(out);
    if (str.length > MAX_ITEM) return;
    lastLive = key;
    N.publishLive(str);
  });
}

function publishPlan(s) {
  return Promise.all([s.plan(), s.progress()]).then(function (v) {
    var p = v[0] || {}, q = v[1] || {};
    var weeks = (q.weeks || []).slice(-26).map(function (w) { return {week: w.week, score: w.score, lv: w.lv}; });
    var level = 0, out, str;
    do {
      out = {routines: slimRoutines(p.routines, level), suggested: p.suggested || '', week: p.week || null,
        lifter: p.lifter || q.overall || null, generated: 0, progress: {overall: q.overall || p.lifter || null, weeks: weeks}};
      str = JSON.stringify(out);
      level++;
    } while (str.length > MAX_ITEM && level <= 2);
    if (str.length > MAX_ITEM) return;
    if (str === lastPlan) return;
    lastPlan = str;
    out.generated = Date.now();
    N.publishPlan(JSON.stringify(out));
  });
}

function sync() {
  var s = S();
  if (!s || !s.live) return Promise.resolve();
  if (running) { again = true; return Promise.resolve(); }
  running = true; quiet = true;
  var ops = parse(N.drainWatchOps(), []);
  if (!Array.isArray(ops)) ops = [];
  ops.sort(byTime);
  var failed = false;
  var applied = ops.length
    ? s.op({ops: ops}).then(function () { return ops.map(function (o) { return o.id; }); }, function () { failed = true; return []; })
    : Promise.resolve([]);
  return applied.then(function (ids) {
    // live first, then the ack: the watch adopts the phone's state when the queue is empty
    return publishLive(s).then(function () { if (ids.length) N.ackWatchOps(JSON.stringify(ids)); });
  }).then(function () { return publishPlan(s); })
    .catch(function (e) { failed = true; if (g.console) console.error('watch link', e); })
    .then(function () {
      running = false; quiet = false;
      if (failed) { clearTimeout(retry); retry = setTimeout(sync, 8000); return; }   // e.g. owner's server unreachable
      if (again) { again = false; return sync(); }
      if (N.pendingCount && N.pendingCount() > 0) return sync();   // more arrived while we worked
      if (N.done) N.done();   // lets a background (headless) page shut itself down
    });
}

/* debounced: many store writes in a row = one publish */
function poke(delay) {
  if (quiet) return;
  clearTimeout(timer);
  timer = setTimeout(sync, delay == null ? 600 : delay);
}

/* anything that changes what the watch shows goes through these store calls */
var WRAP = ['op', 'routine', 'customExercise', 'onboard', 'restore', 'saveWorkout', 'addWorkout', 'deleteWorkout', 'note', 'set'];
function attach(store) {
  if (!store || attached === store) return;
  attached = store;
  WRAP.forEach(function (name) {
    var f = store[name];
    if (typeof f !== 'function') return;
    store[name] = function () {
      var r = f.apply(store, arguments);
      if (r && typeof r.then === 'function') r.then(function () { poke(name === 'op' ? 250 : 1200); }, function () {});
      else poke(1200);
      return r;
    };
  });
  sync();
}

g.GymWatch = {attach: attach, poke: function () { poke(0); }, sync: sync};
document.addEventListener('visibilitychange', function () { if (!document.hidden) poke(300); });
})(window);
